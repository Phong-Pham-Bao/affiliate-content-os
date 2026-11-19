import crypto from 'node:crypto';
import {
  generateUuidV7,
  OAuthTransactionExpiredError,
  OAuthTransactionReplayedError,
  SocialAccountMismatchError,
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
} from '@affiliate-content-os/application';
import { appendCallbackAuditEvent } from './social-callback-audit.js';
import type { Database } from '../../database/types.js';
import {
  mapOAuthCallbackResultRow,
  mapSocialAccountRow,
  type OAuthCallbackResultRow,
  type OAuthTransactionRow,
  type SocialAccountRow,
} from './postgres-social-mappers.js';
import {
  SQL_CONSUME_CLAIMED_TRANSACTION,
  SQL_FIND_ACTIVE_ACCOUNT_FOR_UPDATE,
  SQL_INSERT_CALLBACK_RESULT,
  SQL_INSERT_SOCIAL_ACCOUNT,
  SQL_INSERT_SOCIAL_CREDENTIALS,
  SQL_LOCK_TRANSACTION_FOR_UPDATE,
  SQL_UPDATE_SOCIAL_ACCOUNT,
  SQL_UPSERT_SOCIAL_CREDENTIALS,
} from './postgres-social-statements.js';

export function computeSocialAccountUpsertAdvisoryLockKey(
  workspaceId: string,
  platform: string,
  providerAccountId: string,
): string {
  const hash = crypto.createHash('sha256');
  hash.update('social_account_upsert_lock:');
  hash.update(workspaceId);
  hash.update(':');
  hash.update(platform);
  hash.update(':');
  hash.update(providerAccountId);
  const digest = hash.digest();
  return digest.readBigInt64BE(0).toString();
}

export async function executeCompleteOAuthCallbackTransaction(
  database: Database,
  params: CompleteOAuthCallbackAtomicParams,
): Promise<CompleteOAuthCallbackAtomicResult> {
  return database.withTransaction(async (tx) => {
    // 1. Lock and validate transaction is in claimed state
    const txRes = await tx.query<OAuthTransactionRow>(SQL_LOCK_TRANSACTION_FOR_UPDATE, [
      params.transactionId,
      params.workspaceId,
    ]);

    if (txRes.rows.length === 0) {
      throw new OAuthTransactionExpiredError('OAuth transaction not found or workspace mismatch');
    }

    const txRow = txRes.rows[0]!;
    if (txRow.status === 'consumed') {
      throw new OAuthTransactionReplayedError('OAuth transaction has already been consumed');
    }
    if (txRow.status !== 'claimed') {
      throw new OAuthTransactionReplayedError(
        `OAuth transaction is in status ${txRow.status}; must be claimed`,
      );
    }

    // 2. Acquire transaction-scoped advisory lock derived from (workspace, platform, provider_account_id)
    // to serialize first-time account insertions and updates concurrently for the same provider identity.
    const accountLockKey = computeSocialAccountUpsertAdvisoryLockKey(
      params.workspaceId,
      params.platform,
      params.providerAccountId,
    );
    await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [accountLockKey]);

    // 3. Resolve authoritative target account ID before encryption
    let isExisting = false;
    let targetAccountId = generateUuidV7();

    if (params.reconnectAccountId) {
      const recRes = await tx.query<SocialAccountRow>(
        'SELECT id, version, provider_account_id FROM social_accounts WHERE workspace_id = $1 AND id = $2 FOR UPDATE;',
        [params.workspaceId, params.reconnectAccountId],
      );
      if (recRes.rows.length === 0) {
        throw new OAuthTransactionExpiredError('Reconnect account not found or workspace mismatch');
      }
      if (recRes.rows[0]!.provider_account_id !== params.providerAccountId) {
        throw new SocialAccountMismatchError(
          'Reconnect transaction is bound to a different provider account',
        );
      }
      targetAccountId = params.reconnectAccountId;
      isExisting = true;
    } else {
      const existingRes = await tx.query<SocialAccountRow>(SQL_FIND_ACTIVE_ACCOUNT_FOR_UPDATE, [
        params.workspaceId,
        params.platform,
        params.providerAccountId,
      ]);
      if (existingRes.rows.length > 0) {
        targetAccountId = existingRes.rows[0]!.id;
        isExisting = true;
      }
    }

    // 4. Encrypt credentials bound authoritatively to targetAccountId
    const encrypted = params.encryptCredentials(targetAccountId);
    const derivedStatus = params.derivedStatus ?? 'active';
    const statusReason = params.statusReason ?? 'initial_exchange_complete';
    const exchangeStage = params.exchangeStage ?? 'completed';

    let accountRow: SocialAccountRow;
    if (isExisting) {
      const updateRes = await tx.query<SocialAccountRow>(SQL_UPDATE_SOCIAL_ACCOUNT, [
        targetAccountId,
        params.displayName,
        params.handle,
        JSON.stringify(params.grantedScopes),
        JSON.stringify(params.capabilities),
        params.capabilitiesCheckedAt,
        params.tokenExpiresAt,
        derivedStatus,
        statusReason,
        exchangeStage,
        params.now,
      ]);
      accountRow = updateRes.rows[0]!;

      await tx.query(SQL_UPSERT_SOCIAL_CREDENTIALS, [
        targetAccountId,
        params.workspaceId,
        Buffer.from(encrypted.accessTokenCiphertext),
        Buffer.from(encrypted.accessTokenIv),
        Buffer.from(encrypted.accessTokenAuthTag),
        encrypted.refreshTokenCiphertext ? Buffer.from(encrypted.refreshTokenCiphertext) : null,
        encrypted.refreshTokenIv ? Buffer.from(encrypted.refreshTokenIv) : null,
        encrypted.refreshTokenAuthTag ? Buffer.from(encrypted.refreshTokenAuthTag) : null,
        encrypted.keyVersion,
        params.tokenExpiresAt,
        JSON.stringify(params.grantedScopes),
        params.now,
      ]);
    } else {
      const insertRes = await tx.query<SocialAccountRow>(SQL_INSERT_SOCIAL_ACCOUNT, [
        targetAccountId,
        params.workspaceId,
        params.platform,
        params.providerAccountId,
        params.displayName,
        params.handle,
        derivedStatus,
        statusReason,
        exchangeStage,
        JSON.stringify(params.grantedScopes),
        JSON.stringify(params.capabilities),
        params.capabilitiesCheckedAt,
        params.tokenExpiresAt,
        params.actorUserId,
        params.environment,
        params.now,
      ]);
      accountRow = insertRes.rows[0]!;

      await tx.query(SQL_INSERT_SOCIAL_CREDENTIALS, [
        targetAccountId,
        params.workspaceId,
        Buffer.from(encrypted.accessTokenCiphertext),
        Buffer.from(encrypted.accessTokenIv),
        Buffer.from(encrypted.accessTokenAuthTag),
        encrypted.refreshTokenCiphertext ? Buffer.from(encrypted.refreshTokenCiphertext) : null,
        encrypted.refreshTokenIv ? Buffer.from(encrypted.refreshTokenIv) : null,
        encrypted.refreshTokenAuthTag ? Buffer.from(encrypted.refreshTokenAuthTag) : null,
        encrypted.keyVersion,
        params.tokenExpiresAt,
        JSON.stringify(params.grantedScopes),
        params.now,
      ]);
    }

    // 4. Mark transaction consumed from claimed state
    await tx.query(SQL_CONSUME_CLAIMED_TRANSACTION, [
      params.transactionId,
      params.now,
      txRow.version,
    ]);

    // 5. Insert callback result
    const cbStatus = params.callbackStatus ?? 'success';
    const cbErrorCode =
      cbStatus === 'partial' ? (params.callbackErrorCode ?? 'partial_exchange') : null;
    const cbErrorDescription =
      cbStatus === 'partial'
        ? (params.callbackErrorDescription ??
          'Account connected with limited capabilities. Re-authentication or review may be required.')
        : null;

    const cbRes = await tx.query<OAuthCallbackResultRow>(SQL_INSERT_CALLBACK_RESULT, [
      generateUuidV7(),
      params.workspaceId,
      params.transactionId,
      params.actorUserId,
      Buffer.from(params.resultKeyHash),
      cbStatus,
      params.platform,
      accountRow.id,
      cbErrorCode,
      cbErrorDescription,
      params.now,
      params.resultExpiresAt,
    ]);

    // 6. Append audit event
    await appendCallbackAuditEvent(tx, params, accountRow.id);

    return {
      account: mapSocialAccountRow(accountRow),
      callbackResult: mapOAuthCallbackResultRow(cbRes.rows[0]!),
    };
  });
}
