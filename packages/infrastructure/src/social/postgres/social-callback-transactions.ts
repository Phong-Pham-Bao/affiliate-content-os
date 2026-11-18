import {
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  OAuthTransactionExpiredError,
  OAuthTransactionReplayedError,
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
} from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
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
  SQL_UPDATE_SOCIAL_CREDENTIALS,
} from './postgres-social-statements.js';

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

    // 2. Resolve authoritative target account ID before encryption
    const existingRes = await tx.query<SocialAccountRow>(SQL_FIND_ACTIVE_ACCOUNT_FOR_UPDATE, [
      params.workspaceId,
      params.platform,
      params.providerAccountId,
    ]);

    let accountRow: SocialAccountRow;
    const isExisting = existingRes.rows.length > 0;
    const targetAccountId = isExisting ? existingRes.rows[0]!.id : generateUuidV7();

    // 3. Encrypt credentials bound authoritatively to targetAccountId
    const encrypted = params.encryptCredentials(targetAccountId);

    if (isExisting) {
      const updateRes = await tx.query<SocialAccountRow>(SQL_UPDATE_SOCIAL_ACCOUNT, [
        targetAccountId,
        params.displayName,
        params.handle,
        JSON.stringify(params.grantedScopes),
        JSON.stringify(params.capabilities),
        params.capabilitiesCheckedAt,
        params.tokenExpiresAt,
        params.now,
      ]);
      accountRow = updateRes.rows[0]!;

      await tx.query(SQL_UPDATE_SOCIAL_CREDENTIALS, [
        params.workspaceId,
        targetAccountId,
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
    const cbRes = await tx.query<OAuthCallbackResultRow>(SQL_INSERT_CALLBACK_RESULT, [
      generateUuidV7(),
      params.workspaceId,
      params.transactionId,
      params.actorUserId,
      Buffer.from(params.resultKeyHash),
      'success',
      params.platform,
      accountRow.id,
      null,
      null,
      params.now,
      params.resultExpiresAt,
    ]);

    // 6. Append audit event
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      actorType: 'user',
      actorUserId: parseUserId(params.actorUserId),
      action: 'social_connection.completed',
      resourceType: 'social_account',
      resourceId: accountRow.id,
      result: 'succeeded',
      reasonCode: null,
      changes: {
        platform: { before: null, after: params.platform },
        status: { before: null, after: 'active' },
      },
      ipHash: params.auditContext?.ipHash ?? null,
      userAgentSummary: params.auditContext?.userAgentSummary ?? null,
      correlationId: params.auditContext?.correlationId
        ? parseCorrelationId(params.auditContext.correlationId)
        : null,
      occurredAt: parseIsoTimestamp(params.now),
      createdAt: parseIsoTimestamp(params.now),
    });

    return {
      account: mapSocialAccountRow(accountRow),
      callbackResult: mapOAuthCallbackResultRow(cbRes.rows[0]!),
    };
  });
}
