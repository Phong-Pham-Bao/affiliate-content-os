import {
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
  type OAuthCallbackResultSnapshot,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  OAuthTransactionReplayedError,
  type RecordFailedOAuthCallbackParams,
} from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
import type { Database } from '../../database/types.js';
import {
  mapOAuthCallbackResultRow,
  type OAuthCallbackResultRow,
} from './postgres-social-mappers.js';
import {
  SQL_FAIL_CLAIMED_TRANSACTION,
  SQL_INSERT_CALLBACK_RESULT,
} from './postgres-social-statements.js';

export async function executeRecordFailedOAuthCallbackTransaction(
  database: Database,
  params: RecordFailedOAuthCallbackParams,
): Promise<OAuthCallbackResultSnapshot> {
  return database.withTransaction(async (tx) => {
    const updateRes = await tx.query(SQL_FAIL_CLAIMED_TRANSACTION, [
      params.transactionId,
      params.now,
    ]);

    if (updateRes.rowCount === 0) {
      throw new OAuthTransactionReplayedError(
        'OAuth transaction is not in claimed state or already finished',
      );
    }

    const cbRes = await tx.query<OAuthCallbackResultRow>(SQL_INSERT_CALLBACK_RESULT, [
      generateUuidV7(),
      params.workspaceId,
      params.transactionId,
      params.actorUserId,
      Buffer.from(params.resultKeyHash),
      'failed',
      params.platform,
      null,
      params.errorCode,
      params.errorDescription,
      params.now,
      params.resultExpiresAt,
    ]);

    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      actorType: 'user',
      actorUserId: parseUserId(params.actorUserId),
      action: 'social_connection.failed',
      resourceType: 'oauth_transaction',
      resourceId: params.transactionId,
      result: 'failed',
      reasonCode: params.errorCode
        ? params.errorCode.toLowerCase().replace(/[^a-z0-9_.]/g, '_')
        : null,
      changes: {
        status: { before: 'claimed', after: 'failed' },
      },
      ipHash: params.auditContext?.ipHash ?? null,
      userAgentSummary: params.auditContext?.userAgentSummary ?? null,
      correlationId: params.auditContext?.correlationId
        ? parseCorrelationId(params.auditContext.correlationId)
        : null,
      occurredAt: parseIsoTimestamp(params.now),
      createdAt: parseIsoTimestamp(params.now),
    });

    return mapOAuthCallbackResultRow(cbRes.rows[0]!);
  });
}
