import {
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
  type OAuthCallbackResultSnapshot,
  type OAuthTransactionSnapshot,
  type SocialAccountSnapshot,
} from '@affiliate-content-os/domain';
import {
  CallbackResultForbiddenError,
  generateUuidV7,
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
  type ClaimOAuthTransactionParams,
  type ClaimSocialAccountForRefreshParams,
  type ClaimedOAuthTransaction,
  type ClaimedSocialAccountRefresh,
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
  type CompleteSocialAccountRefreshParams,
  type ConsumeCallbackResultParams,
  type DisconnectSocialAccountParams,
  type RecordFailedOAuthCallbackParams,
  type RecordFailedSocialAccountRefreshParams,
  type SaveOAuthTransactionParams,
  type SaveOAuthTransactionWithIdempotencyParams,
  type SaveOAuthTransactionWithIdempotencyResult,
  type SocialPersistencePort,
} from '@affiliate-content-os/application';
import {
  createPostgresAuditAdapter,
  createTransactionScopedPostgresAuditAdapter,
} from '../../audit/index.js';
import type { Database } from '../../database/types.js';
import {
  mapOAuthCallbackResultRow,
  mapOAuthTransactionRow,
  mapSocialAccountRow,
  type OAuthCallbackResultRow,
  type OAuthTransactionRow,
  type SocialAccountRow,
} from './postgres-social-mappers.js';
import {
  SQL_CLAIM_TRANSACTION,
  SQL_CONSUME_CALLBACK_RESULT,
  SQL_FIND_CALLBACK_RESULT_BY_KEY,
  SQL_FIND_SOCIAL_ACCOUNT_BY_ID,
  SQL_FIND_TRANSACTION_BY_STATE_HASH,
  SQL_INSERT_OAUTH_TRANSACTION,
  SQL_LIST_SOCIAL_ACCOUNTS,
} from './postgres-social-statements.js';
import { executeCompleteOAuthCallbackTransaction } from './social-callback-transactions.js';
import { executeRecordFailedOAuthCallbackTransaction } from './social-callback-failed-transaction.js';
import { executeSaveOAuthTransactionWithIdempotency } from './social-authorize-idempotency-transaction.js';
import {
  executeClaimSocialAccountForRefresh,
  executeCompleteSocialAccountRefresh,
  executeRecordFailedSocialAccountRefresh,
} from './social-refresh-transactions.js';
import { executeDisconnectSocialAccount } from './social-disconnect-transaction.js';

export class PostgresSocialPersistenceAdapter implements SocialPersistencePort {
  public constructor(private readonly database: Database) {}

  public async saveOAuthTransaction(
    params: SaveOAuthTransactionParams,
  ): Promise<OAuthTransactionSnapshot> {
    const res = await this.database.query<OAuthTransactionRow>(SQL_INSERT_OAUTH_TRANSACTION, [
      params.id,
      params.workspaceId,
      params.platform,
      params.initiatedByUserId,
      Buffer.from(params.stateHash),
      params.pkceVerifierCiphertext ? Buffer.from(params.pkceVerifierCiphertext) : null,
      params.pkceVerifierIv ? Buffer.from(params.pkceVerifierIv) : null,
      params.pkceVerifierAuthTag ? Buffer.from(params.pkceVerifierAuthTag) : null,
      params.encryptionKeyVersion ?? null,
      params.redirectUri,
      params.returnTo,
      JSON.stringify(params.requestedScopes),
      params.reconnectAccountId ?? null,
      params.expectedProviderAccountId ?? null,
      params.exchangeStage ?? 'code_received',
      params.createdAt,
      params.expiresAt,
    ]);
    return mapOAuthTransactionRow(res.rows[0]!);
  }

  public async saveOAuthTransactionWithIdempotency(
    params: SaveOAuthTransactionWithIdempotencyParams,
  ): Promise<SaveOAuthTransactionWithIdempotencyResult> {
    return executeSaveOAuthTransactionWithIdempotency(this.database, params);
  }

  public async claimOAuthTransaction(
    params: ClaimOAuthTransactionParams,
  ): Promise<ClaimedOAuthTransaction> {
    const claimResult = await this.database.withTransaction(async (tx) => {
      const res = await tx.query<
        OAuthTransactionRow & {
          pkce_verifier_ciphertext: Buffer | null;
          pkce_verifier_iv: Buffer | null;
          pkce_verifier_auth_tag: Buffer | null;
          encryption_key_version: string | null;
        }
      >(SQL_CLAIM_TRANSACTION, [
        Buffer.from(params.stateHash),
        params.platform,
        params.now,
        params.claimTtlSeconds,
      ]);

      if (res.rows.length === 1) {
        const row = res.rows[0]!;
        let encryptedVerifier;
        if (
          row.pkce_verifier_ciphertext &&
          row.pkce_verifier_iv &&
          row.pkce_verifier_auth_tag &&
          row.encryption_key_version
        ) {
          encryptedVerifier = {
            ciphertext: new Uint8Array(
              row.pkce_verifier_ciphertext.buffer,
              row.pkce_verifier_ciphertext.byteOffset,
              row.pkce_verifier_ciphertext.byteLength,
            ),
            iv: new Uint8Array(
              row.pkce_verifier_iv.buffer,
              row.pkce_verifier_iv.byteOffset,
              row.pkce_verifier_iv.byteLength,
            ),
            authTag: new Uint8Array(
              row.pkce_verifier_auth_tag.buffer,
              row.pkce_verifier_auth_tag.byteOffset,
              row.pkce_verifier_auth_tag.byteLength,
            ),
            keyVersion: row.encryption_key_version,
          };
        }

        const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
        await auditAdapter.appendAuditEvent({
          id: parseAuditEventId(generateUuidV7()),
          workspaceId: parseWorkspaceId(row.workspace_id),
          actorType: 'user',
          actorUserId: parseUserId(row.initiated_by_user_id),
          action: 'social_connection.authorization_claimed',
          resourceType: 'oauth_transaction',
          resourceId: row.id,
          result: 'succeeded',
          reasonCode: null,
          changes: {
            platform: { before: null, after: row.platform },
            status: { before: 'pending', after: 'claimed' },
          },
          ipHash: params.auditContext?.ipHash ?? null,
          userAgentSummary: params.auditContext?.userAgentSummary ?? null,
          correlationId: params.auditContext?.correlationId
            ? parseCorrelationId(params.auditContext.correlationId)
            : null,
          occurredAt: parseIsoTimestamp(params.now),
          createdAt: parseIsoTimestamp(params.now),
        });

        const snap = mapOAuthTransactionRow(row);
        return {
          id: snap.id,
          workspaceId: snap.workspaceId,
          platform: snap.platform,
          initiatedByUserId: snap.initiatedByUserId,
          redirectUri: snap.redirectUri,
          returnTo: snap.returnTo,
          requestedScopes: snap.requestedScopes,
          encryptedVerifier,
          createdAt: snap.createdAt,
          expiresAt: snap.expiresAt,
          claimedAt: snap.claimedAt ?? params.now,
          version: snap.version,
        };
      }

      return null;
    });

    if (claimResult !== null) {
      return claimResult;
    }

    // Diagnosing failure reason
    const checkRes = await this.database.query<OAuthTransactionRow>(
      SQL_FIND_TRANSACTION_BY_STATE_HASH,
      [Buffer.from(params.stateHash)],
    );

    if (checkRes.rows.length === 0) {
      throw new OAuthTransactionNotFoundError();
    }

    const checkRow = checkRes.rows[0]!;
    if (checkRow.platform !== params.platform) {
      throw new OAuthCallbackInvalidError('Platform mismatch for OAuth transaction.');
    }

    if (new Date(checkRow.expires_at).getTime() <= new Date(params.now).getTime()) {
      throw new OAuthTransactionExpiredError('OAuth transaction has expired.');
    }

    if (
      checkRow.status === 'claimed' ||
      checkRow.status === 'consumed' ||
      checkRow.status === 'failed' ||
      checkRow.status === 'expired'
    ) {
      // Replay detected: record replay rejection audit event
      try {
        const auditAdapter = createPostgresAuditAdapter(this.database);
        await auditAdapter.appendAuditEvent({
          id: parseAuditEventId(generateUuidV7()),
          workspaceId: parseWorkspaceId(checkRow.workspace_id),
          actorType: 'user',
          actorUserId: parseUserId(checkRow.initiated_by_user_id),
          action: 'social_connection.replay_rejected',
          resourceType: 'oauth_transaction',
          resourceId: checkRow.id,
          result: 'denied',
          reasonCode:
            checkRow.status === 'claimed'
              ? 'transaction_already_claimed'
              : checkRow.status === 'consumed'
                ? 'transaction_already_consumed'
                : 'transaction_replayed',
          changes: {
            claim_status: { before: checkRow.status, after: 'rejected' },
          },
          ipHash: params.auditContext?.ipHash ?? null,
          userAgentSummary: params.auditContext?.userAgentSummary ?? null,
          correlationId: params.auditContext?.correlationId
            ? parseCorrelationId(params.auditContext.correlationId)
            : null,
          occurredAt: parseIsoTimestamp(params.now),
          createdAt: parseIsoTimestamp(params.now),
        });
      } catch {
        // Audit failure must not turn replay into success
      }

      throw new OAuthTransactionReplayedError(
        'OAuth transaction state has already been claimed or consumed.',
      );
    }

    throw new OAuthTransactionReplayedError('OAuth transaction is not in pending state.');
  }

  public async findPendingTransactionByStateHash(
    stateHash: Uint8Array,
  ): Promise<OAuthTransactionSnapshot | null> {
    const res = await this.database.query<OAuthTransactionRow>(SQL_FIND_TRANSACTION_BY_STATE_HASH, [
      Buffer.from(stateHash),
    ]);
    if (res.rows.length === 0) return null;
    return mapOAuthTransactionRow(res.rows[0]!);
  }

  public async completeOAuthCallbackAtomic(
    params: CompleteOAuthCallbackAtomicParams,
  ): Promise<CompleteOAuthCallbackAtomicResult> {
    return executeCompleteOAuthCallbackTransaction(this.database, params);
  }

  public async recordFailedOAuthCallbackAtomic(
    params: RecordFailedOAuthCallbackParams,
  ): Promise<OAuthCallbackResultSnapshot> {
    return executeRecordFailedOAuthCallbackTransaction(this.database, params);
  }

  public async consumeCallbackResult(
    params: ConsumeCallbackResultParams,
  ): Promise<OAuthCallbackResultSnapshot | null> {
    const res = await this.database.query<OAuthCallbackResultRow>(SQL_CONSUME_CALLBACK_RESULT, [
      params.workspaceId,
      params.actorUserId,
      Buffer.from(params.resultKeyHash),
      params.now,
    ]);

    if (res.rows.length === 1) {
      return mapOAuthCallbackResultRow(res.rows[0]!);
    }

    // Diagnostics for actor/expiry/existence mismatch
    const checkRes = await this.database.query<OAuthCallbackResultRow>(
      SQL_FIND_CALLBACK_RESULT_BY_KEY,
      [params.workspaceId, Buffer.from(params.resultKeyHash)],
    );

    if (checkRes.rows.length === 0) {
      return null;
    }

    const checkRow = checkRes.rows[0]!;
    if (checkRow.initiated_by_user_id !== params.actorUserId) {
      throw new CallbackResultForbiddenError('Not authorized to consume this callback result.');
    }

    return null;
  }

  public async listSocialAccounts(params: {
    workspaceId: string;
  }): Promise<SocialAccountSnapshot[]> {
    const res = await this.database.query<SocialAccountRow>(SQL_LIST_SOCIAL_ACCOUNTS, [
      params.workspaceId,
    ]);
    return res.rows.map(mapSocialAccountRow);
  }

  public async findSocialAccountById(params: {
    workspaceId: string;
    accountId: string;
  }): Promise<SocialAccountSnapshot | null> {
    const res = await this.database.query<SocialAccountRow>(SQL_FIND_SOCIAL_ACCOUNT_BY_ID, [
      params.workspaceId,
      params.accountId,
    ]);
    if (res.rows.length === 0) return null;
    return mapSocialAccountRow(res.rows[0]!);
  }

  public async findSocialAccountForUpdate(params: {
    workspaceId: string;
    accountId: string;
  }): Promise<SocialAccountSnapshot | null> {
    const res = await this.database.query<SocialAccountRow>(
      `${SQL_FIND_SOCIAL_ACCOUNT_BY_ID} FOR UPDATE;`,
      [params.workspaceId, params.accountId],
    );
    if (res.rows.length === 0) return null;
    return mapSocialAccountRow(res.rows[0]!);
  }

  public async claimSocialAccountForRefresh(
    params: ClaimSocialAccountForRefreshParams,
  ): Promise<ClaimedSocialAccountRefresh | null> {
    return executeClaimSocialAccountForRefresh(this.database, params);
  }

  public async completeSocialAccountRefreshAtomic(
    params: CompleteSocialAccountRefreshParams,
  ): Promise<SocialAccountSnapshot> {
    return executeCompleteSocialAccountRefresh(this.database, params);
  }

  public async recordFailedSocialAccountRefreshAtomic(
    params: RecordFailedSocialAccountRefreshParams,
  ): Promise<SocialAccountSnapshot> {
    return executeRecordFailedSocialAccountRefresh(this.database, params);
  }

  public async disconnectSocialAccountAtomic(
    params: DisconnectSocialAccountParams,
  ): Promise<SocialAccountSnapshot> {
    return executeDisconnectSocialAccount(this.database, params);
  }
}
