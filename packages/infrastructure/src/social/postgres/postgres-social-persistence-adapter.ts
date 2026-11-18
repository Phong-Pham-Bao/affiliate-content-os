import {
  type OAuthCallbackResultSnapshot,
  type OAuthTransactionSnapshot,
  type SocialAccountSnapshot,
} from '@affiliate-content-os/domain';
import {
  CallbackResultForbiddenError,
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
  type ClaimOAuthTransactionParams,
  type ClaimedOAuthTransaction,
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
  type ConsumeCallbackResultParams,
  type RecordFailedOAuthCallbackParams,
  type SaveOAuthTransactionParams,
  type SaveOAuthTransactionWithIdempotencyParams,
  type SaveOAuthTransactionWithIdempotencyResult,
  type SocialPersistencePort,
} from '@affiliate-content-os/application';
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
    const res = await this.database.query<
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
}
