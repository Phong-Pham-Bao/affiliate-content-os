import {
  generateUuidV7,
  CallbackResultForbiddenError,
  CallbackResultGoneError,
  CallbackResultNotFoundError,
  IdempotencyKeyReusedError,
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
  SocialAccountNotFoundError,
  SocialAccountVersionMismatchError,
  type ClaimNextDueSocialAccountParams,
  type ClaimOAuthTransactionParams,
  type ClaimSocialAccountForRefreshParams,
  type ClaimedOAuthTransaction,
  type ClaimedSocialAccountRefresh,
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
  type CompleteSocialAccountRefreshParams,
  type ConsumeCallbackResultParams,
  type DisconnectSocialAccountParams,
  type EncryptedSocialCredentials,
  type RecordFailedOAuthCallbackParams,
  type RecordFailedSocialAccountRefreshParams,
  type ReleaseSocialAccountRefreshLeaseParams,
  type SaveOAuthTransactionParams,
  type SaveOAuthTransactionWithIdempotencyParams,
  type SaveOAuthTransactionWithIdempotencyResult,
  type SocialIdempotencyInput,
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

import { LocalSocialCredentialProtector } from '@affiliate-content-os/infrastructure/social';

export class InMemorySocialPersistence implements SocialPersistencePort {
  private readonly defaultProtector = new LocalSocialCredentialProtector(
    'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE',
    'v1',
  );
  public transactions = new Map<string, OAuthTransactionSnapshot>();
  public accounts = new Map<string, SocialAccountSnapshot>();
  public credentials = new Map<string, EncryptedSocialCredentials>();
  public callbackResults = new Map<string, OAuthCallbackResultSnapshot>();
  public idempotencyKeys = new Map<
    string,
    {
      readonly principalId: string;
      readonly routeKey: string;
      readonly keyHash: Uint8Array;
      readonly requestHash: Uint8Array;
      readonly response: unknown;
      readonly expiresAt: string;
    }
  >();

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
      claimedAt: null,
      claimedExpiresAt: null,
      consumedAt: null,
      createdAt: params.createdAt,
      expiresAt: params.expiresAt,
      version: 1,
    };
    this.transactions.set(tx.id, tx);
    return tx;
  }

  public async saveOAuthTransactionWithIdempotency(
    params: SaveOAuthTransactionWithIdempotencyParams,
  ): Promise<SaveOAuthTransactionWithIdempotencyResult> {
    const idempKey = `${params.workspaceId}:${params.initiatedByUserId}:${params.routeKey}:${Buffer.from(params.keyHash).toString('hex')}`;
    const existing = this.idempotencyKeys.get(idempKey);

    if (existing) {
      if (new Date(existing.expiresAt).getTime() <= new Date(params.createdAt).getTime()) {
        this.idempotencyKeys.delete(idempKey);
      } else {
        if (!Buffer.from(existing.requestHash).equals(Buffer.from(params.requestHash))) {
          throw new IdempotencyKeyReusedError();
        }
        return {
          replayed: true,
          response: existing.response as SaveOAuthTransactionWithIdempotencyResult['response'],
        };
      }
    }

    await this.saveOAuthTransaction(params);
    this.idempotencyKeys.set(idempKey, {
      principalId: params.initiatedByUserId,
      routeKey: params.routeKey,
      keyHash: params.keyHash,
      requestHash: params.requestHash,
      response: params.responseData,
      expiresAt: params.expiresAt,
    });

    return {
      replayed: false,
      response: params.responseData,
    };
  }

  public async claimOAuthTransaction(
    params: ClaimOAuthTransactionParams,
  ): Promise<ClaimedOAuthTransaction> {
    const hashBuf = Buffer.from(params.stateHash);
    let matchedTx: OAuthTransactionSnapshot | undefined;

    for (const tx of this.transactions.values()) {
      if (Buffer.from(tx.stateHash).equals(hashBuf)) {
        matchedTx = tx;
        break;
      }
    }

    if (!matchedTx) {
      throw new OAuthTransactionNotFoundError();
    }
    if (matchedTx.platform !== params.platform) {
      throw new OAuthCallbackInvalidError('Platform mismatch for OAuth transaction.');
    }
    if (new Date(matchedTx.expiresAt).getTime() <= new Date(params.now).getTime()) {
      throw new OAuthTransactionExpiredError('OAuth transaction has expired.');
    }
    if (matchedTx.status !== 'pending') {
      throw new OAuthTransactionReplayedError(
        'OAuth transaction state has already been claimed or consumed.',
      );
    }

    const claimedTx: OAuthTransactionSnapshot = {
      ...matchedTx,
      status: 'claimed',
      claimedAt: params.now,
      version: matchedTx.version + 1,
    };
    this.transactions.set(claimedTx.id, claimedTx);

    return {
      id: claimedTx.id,
      workspaceId: claimedTx.workspaceId,
      platform: claimedTx.platform,
      initiatedByUserId: claimedTx.initiatedByUserId,
      redirectUri: claimedTx.redirectUri,
      returnTo: claimedTx.returnTo,
      requestedScopes: claimedTx.requestedScopes,
      createdAt: claimedTx.createdAt,
      expiresAt: claimedTx.expiresAt,
      claimedAt: params.now,
      version: claimedTx.version,
    };
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
    if (tx.status !== 'claimed') {
      throw new OAuthTransactionReplayedError(
        `Transaction in status ${tx.status}; must be claimed`,
      );
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
    // Authoritatively encrypt credentials with resolved accountId
    params.encryptCredentials(accountId);

    const account: SocialAccountSnapshot = {
      id: accountId,
      workspaceId: parseWorkspaceId(params.workspaceId),
      platform: params.platform,
      providerAccountId: params.providerAccountId,
      displayName: params.displayName,
      handle: params.handle,
      status: params.derivedStatus ?? 'active',
      statusReason: params.statusReason ?? null,
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
      initiatedByUserId: parseUserId(params.actorUserId),
      resultKeyHash: Buffer.from(params.resultKeyHash),
      status: params.callbackStatus ?? 'success',
      platform: params.platform,
      socialAccountId: account.id,
      errorCode: params.callbackErrorCode ?? null,
      errorDescription: params.callbackErrorDescription ?? null,
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
    if (!tx || tx.status !== 'claimed') {
      throw new OAuthTransactionReplayedError('Transaction not in claimed state');
    }

    this.transactions.set(tx.id, {
      ...tx,
      status: 'failed',
      consumedAt: params.now,
      version: tx.version + 1,
    });

    const callbackResult: OAuthCallbackResultSnapshot = {
      id: parseCallbackResultId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      transactionId: parseOAuthTransactionId(params.transactionId),
      initiatedByUserId: parseUserId(params.actorUserId),
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
    let foundResult: OAuthCallbackResultSnapshot | undefined;

    for (const res of this.callbackResults.values()) {
      if (
        res.workspaceId === params.workspaceId &&
        Buffer.from(res.resultKeyHash).equals(keyHashBuf)
      ) {
        foundResult = res;
        break;
      }
    }

    if (!foundResult) {
      throw new CallbackResultNotFoundError('OAuth callback result was not found.');
    }

    if (foundResult.initiatedByUserId !== params.actorUserId) {
      throw new CallbackResultForbiddenError('Not authorized to consume this callback result.');
    }

    if (
      foundResult.consumedAt !== null ||
      new Date(foundResult.expiresAt).getTime() <= new Date(params.now).getTime()
    ) {
      throw new CallbackResultGoneError(
        'OAuth callback result has expired or has already been consumed.',
      );
    }

    const consumed: OAuthCallbackResultSnapshot = {
      ...foundResult,
      consumedAt: params.now,
      version: foundResult.version + 1,
    };
    this.callbackResults.set(foundResult.id, consumed);
    return consumed;
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

  public async findSocialAccountForUpdate(params: {
    readonly workspaceId: string;
    readonly accountId: string;
  }): Promise<SocialAccountSnapshot | null> {
    return this.findSocialAccountById(params);
  }

  public async findEncryptedCredentials(params: {
    readonly workspaceId: string;
    readonly accountId: string;
  }): Promise<EncryptedSocialCredentials | null> {
    return this.credentials.get(params.accountId) ?? null;
  }

  public async claimSocialAccountForRefresh(
    params: ClaimSocialAccountForRefreshParams,
  ): Promise<ClaimedSocialAccountRefresh | null> {
    const acc = await this.findSocialAccountById(params);
    if (!acc) return null;

    let encryptedCredentials = this.credentials.get(acc.id);
    if (!encryptedCredentials) {
      encryptedCredentials = this.defaultProtector.encrypt({
        workspaceId: params.workspaceId,
        socialAccountId: acc.id,
        platform: acc.platform,
        accessToken: 'fake_access_token_123',
      });
      this.credentials.set(acc.id, encryptedCredentials);
    }

    return {
      account: acc,
      encryptedCredentials,
      claimedAccountVersion: acc.version,
      claimedCredentialVersion: 1,
      refreshLeaseToken: params.claimToken ?? generateUuidV7(),
    };
  }

  public async claimNextDueSocialAccountForRefresh(
    params: ClaimNextDueSocialAccountParams,
  ): Promise<ClaimedSocialAccountRefresh | null> {
    for (const acc of this.accounts.values()) {
      if (acc.status === 'active' || acc.status === 'degraded') {
        return this.claimSocialAccountForRefresh({
          workspaceId: acc.workspaceId,
          accountId: acc.id,
          now: params.now,
          workerId: params.workerId,
          leaseDurationSeconds: params.leaseDurationSeconds,
          claimToken: params.claimToken,
        });
      }
    }
    return null;
  }

  public async releaseSocialAccountRefreshLeaseAtomic(
    _params: ReleaseSocialAccountRefreshLeaseParams,
  ): Promise<void> {
    // No-op in memory
  }

  public async completeSocialAccountRefreshAtomic(
    params: CompleteSocialAccountRefreshParams,
  ): Promise<SocialAccountSnapshot> {
    const acc = await this.findSocialAccountById(params);
    if (!acc) throw new SocialAccountNotFoundError();
    if (acc.version !== params.expectedAccountVersion) {
      throw new SocialAccountVersionMismatchError();
    }

    const updated: SocialAccountSnapshot = {
      ...acc,
      status: params.derivedStatus,
      statusReason: params.statusReason,
      capabilitiesCheckedAt: params.now,
      lastRefreshedAt: params.now,
      nextRefreshAt: params.nextRefreshAt,
      allowedActions: Object.freeze(['reconnect', 'refresh', 'disconnect']),
      version: acc.version + 1,
      updatedAt: params.now,
    };
    this.accounts.set(updated.id, updated);
    return updated;
  }

  public async recordFailedSocialAccountRefreshAtomic(
    params: RecordFailedSocialAccountRefreshParams,
  ): Promise<SocialAccountSnapshot> {
    const acc = await this.findSocialAccountById(params);
    if (!acc) throw new SocialAccountNotFoundError();

    const updated: SocialAccountSnapshot = {
      ...acc,
      status: params.derivedStatus,
      statusReason: params.statusReason,
      reauthRequiredAt: params.reauthRequiredAt ?? acc.reauthRequiredAt,
      allowedActions: Object.freeze(
        params.derivedStatus === 'reauth_required'
          ? ['reconnect', 'disconnect']
          : ['reconnect', 'refresh', 'disconnect'],
      ),
      version: acc.version + 1,
      updatedAt: params.now,
    };
    this.accounts.set(updated.id, updated);
    return updated;
  }

  public async disconnectSocialAccountAtomic(
    params: DisconnectSocialAccountParams,
  ): Promise<SocialAccountSnapshot> {
    const acc = await this.findSocialAccountById(params);
    if (!acc) throw new SocialAccountNotFoundError();
    if (acc.version !== params.expectedVersion) {
      throw new SocialAccountVersionMismatchError();
    }

    const updated: SocialAccountSnapshot = {
      ...acc,
      status: 'disconnected',
      statusReason: 'disconnected_by_user',
      externalRevocationResult: params.externalRevocationResult,
      externalRevocationSupported: params.externalRevocationSupported,
      allowedActions: Object.freeze(['reconnect']),
      version: acc.version + 1,
      updatedAt: params.now,
    };
    this.accounts.set(updated.id, updated);
    return updated;
  }

  public async executeMutationWithIdempotency(params: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly actorUserId: string;
    readonly idempotency: SocialIdempotencyInput;
    readonly now: string;
    readonly executeMutation: () => Promise<SocialAccountSnapshot>;
  }): Promise<{ readonly replayed: boolean; readonly account: SocialAccountSnapshot }> {
    const idempKey = `${params.workspaceId}:${params.actorUserId}:${params.idempotency.routeKey}:${Buffer.from(params.idempotency.keyHash).toString('hex')}`;
    const existing = this.idempotencyKeys.get(idempKey);

    if (existing) {
      if (new Date(existing.expiresAt).getTime() <= new Date(params.now).getTime()) {
        this.idempotencyKeys.delete(idempKey);
      } else {
        if (
          !Buffer.from(existing.requestHash).equals(Buffer.from(params.idempotency.requestHash))
        ) {
          throw new IdempotencyKeyReusedError();
        }
        return {
          replayed: true,
          account: existing.response as SocialAccountSnapshot,
        };
      }
    }

    const account = await params.executeMutation();
    const expiresAt = new Date(Date.parse(params.now) + 86400 * 1000).toISOString();
    this.idempotencyKeys.set(idempKey, {
      principalId: params.actorUserId,
      routeKey: params.idempotency.routeKey,
      keyHash: params.idempotency.keyHash,
      requestHash: params.idempotency.requestHash,
      response: account,
      expiresAt,
    });

    return {
      replayed: false,
      account,
    };
  }
}
