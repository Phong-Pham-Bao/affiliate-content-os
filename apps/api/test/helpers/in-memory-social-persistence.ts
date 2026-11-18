import {
  generateUuidV7,
  OAuthTransactionExpiredError,
  OAuthTransactionReplayedError,
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
  type ConsumeCallbackResultParams,
  type RecordFailedOAuthCallbackParams,
  type SaveOAuthTransactionParams,
  type SocialPersistencePort,
} from '@affiliate-content-os/application';
import {
  parseCallbackResultId,
  parseOAuthTransactionId,
  parseSocialAccountId,
  parseUserId,
  parseWorkspaceId,
  type OAuthCallbackResultSnapshot,
  type OAuthTransactionSnapshot,
  type SocialAccountSnapshot,
} from '@affiliate-content-os/domain';

export class InMemorySocialPersistence implements SocialPersistencePort {
  public transactions = new Map<string, OAuthTransactionSnapshot>();
  public accounts = new Map<string, SocialAccountSnapshot>();
  public callbackResults = new Map<string, OAuthCallbackResultSnapshot>();

  public async saveOAuthTransaction(
    params: SaveOAuthTransactionParams,
  ): Promise<OAuthTransactionSnapshot> {
    const tx: OAuthTransactionSnapshot = {
      id: parseOAuthTransactionId(params.id),
      workspaceId: parseWorkspaceId(params.workspaceId),
      platform: params.platform,
      initiatedByUserId: parseUserId(params.initiatedByUserId),
      stateHash: Buffer.from(params.stateHash),
      redirectUri: params.redirectUri,
      returnTo: params.returnTo,
      requestedScopes: Object.freeze([...params.requestedScopes]),
      status: 'pending',
      consumedAt: null,
      createdAt: params.createdAt,
      expiresAt: params.expiresAt,
      version: 1,
    };
    this.transactions.set(tx.id, tx);
    return tx;
  }

  public async findPendingTransactionByStateHash(
    stateHash: Uint8Array,
  ): Promise<OAuthTransactionSnapshot | null> {
    const hashBuf = Buffer.from(stateHash);
    for (const tx of this.transactions.values()) {
      if (Buffer.from(tx.stateHash).equals(hashBuf)) {
        return tx;
      }
    }
    return null;
  }

  public async completeOAuthCallbackAtomic(
    params: CompleteOAuthCallbackAtomicParams,
  ): Promise<CompleteOAuthCallbackAtomicResult> {
    const tx = this.transactions.get(params.transactionId);
    if (!tx || !Buffer.from(tx.stateHash).equals(Buffer.from(params.stateHash))) {
      throw new OAuthTransactionExpiredError('Transaction not found or state mismatch');
    }
    if (tx.status === 'consumed') {
      throw new OAuthTransactionReplayedError('Transaction already consumed');
    }
    if (new Date(tx.expiresAt).getTime() <= new Date(params.now).getTime()) {
      throw new OAuthTransactionExpiredError('Transaction expired');
    }

    const updatedTx: OAuthTransactionSnapshot = {
      ...tx,
      status: 'consumed',
      consumedAt: params.now,
      version: tx.version + 1,
    };
    this.transactions.set(tx.id, updatedTx);

    // Find existing account for convergence
    let existingAccount: SocialAccountSnapshot | undefined;
    for (const acc of this.accounts.values()) {
      if (
        acc.workspaceId === params.workspaceId &&
        acc.platform === params.platform &&
        acc.providerAccountId === params.providerAccountId &&
        acc.status !== 'disconnected'
      ) {
        existingAccount = acc;
        break;
      }
    }

    const accountId = existingAccount ? existingAccount.id : parseSocialAccountId(generateUuidV7());
    const account: SocialAccountSnapshot = {
      id: accountId,
      workspaceId: parseWorkspaceId(params.workspaceId),
      platform: params.platform,
      providerAccountId: params.providerAccountId,
      displayName: params.displayName,
      handle: params.handle,
      status: 'active',
      grantedScopes: Object.freeze([...params.grantedScopes]),
      capabilities: Object.freeze({ ...params.capabilities }),
      capabilitiesCheckedAt: params.capabilitiesCheckedAt,
      tokenExpiresAt: params.tokenExpiresAt,
      connectedByUserId: parseUserId(params.actorUserId),
      disconnectedAt: null,
      environment: params.environment,
      createdAt: existingAccount ? existingAccount.createdAt : params.now,
      updatedAt: params.now,
      version: existingAccount ? existingAccount.version + 1 : 1,
    };
    this.accounts.set(account.id, account);

    const callbackResult: OAuthCallbackResultSnapshot = {
      id: parseCallbackResultId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      transactionId: parseOAuthTransactionId(params.transactionId),
      resultKeyHash: Buffer.from(params.resultKeyHash),
      status: 'success',
      platform: params.platform,
      socialAccountId: account.id,
      errorCode: null,
      errorDescription: null,
      consumedAt: null,
      createdAt: params.now,
      expiresAt: params.resultExpiresAt,
      version: 1,
    };
    this.callbackResults.set(callbackResult.id, callbackResult);

    return { account, callbackResult };
  }

  public async recordFailedOAuthCallbackAtomic(
    params: RecordFailedOAuthCallbackParams,
  ): Promise<OAuthCallbackResultSnapshot> {
    const tx = this.transactions.get(params.transactionId);
    if (tx) {
      this.transactions.set(tx.id, {
        ...tx,
        status: 'failed',
        consumedAt: params.now,
        version: tx.version + 1,
      });
    }

    const callbackResult: OAuthCallbackResultSnapshot = {
      id: parseCallbackResultId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      transactionId: parseOAuthTransactionId(params.transactionId),
      resultKeyHash: Buffer.from(params.resultKeyHash),
      status: 'failed',
      platform: params.platform,
      socialAccountId: null,
      errorCode: params.errorCode,
      errorDescription: params.errorDescription,
      consumedAt: null,
      createdAt: params.now,
      expiresAt: params.resultExpiresAt,
      version: 1,
    };
    this.callbackResults.set(callbackResult.id, callbackResult);
    return callbackResult;
  }

  public async consumeCallbackResult(
    params: ConsumeCallbackResultParams,
  ): Promise<OAuthCallbackResultSnapshot | null> {
    const keyHashBuf = Buffer.from(params.resultKeyHash);
    for (const [id, res] of this.callbackResults.entries()) {
      if (
        res.workspaceId === params.workspaceId &&
        Buffer.from(res.resultKeyHash).equals(keyHashBuf) &&
        res.consumedAt === null &&
        new Date(res.expiresAt).getTime() > new Date(params.now).getTime()
      ) {
        const consumed: OAuthCallbackResultSnapshot = {
          ...res,
          consumedAt: params.now,
          version: res.version + 1,
        };
        this.callbackResults.set(id, consumed);
        return consumed;
      }
    }
    return null;
  }

  public async listSocialAccounts(params: {
    workspaceId: string;
  }): Promise<SocialAccountSnapshot[]> {
    const list: SocialAccountSnapshot[] = [];
    for (const acc of this.accounts.values()) {
      if (acc.workspaceId === params.workspaceId) {
        list.push(acc);
      }
    }
    return list;
  }

  public async findSocialAccountById(params: {
    workspaceId: string;
    accountId: string;
  }): Promise<SocialAccountSnapshot | null> {
    const acc = this.accounts.get(params.accountId);
    if (acc && acc.workspaceId === params.workspaceId) {
      return acc;
    }
    return null;
  }
}
