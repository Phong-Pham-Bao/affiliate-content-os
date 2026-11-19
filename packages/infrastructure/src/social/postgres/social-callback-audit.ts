import {
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { generateUuidV7 } from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
import type { TransactionExecutor } from '../../database/types.js';
import type { CompleteOAuthCallbackAtomicParams } from '@affiliate-content-os/application';

export async function appendCallbackAuditEvent(
  tx: TransactionExecutor,
  params: CompleteOAuthCallbackAtomicParams,
  accountId: string,
): Promise<void> {
  const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
  const action = params.reconnectAccountId
    ? 'social_connection.reconnected'
    : 'social_connection.completed';
  const isPartial = params.callbackStatus === 'partial';
  await auditAdapter.appendAuditEvent({
    id: parseAuditEventId(generateUuidV7()),
    workspaceId: parseWorkspaceId(params.workspaceId),
    actorType: 'user',
    actorUserId: parseUserId(params.actorUserId),
    action,
    resourceType: 'social_account',
    resourceId: accountId,
    result: isPartial ? 'failed' : 'succeeded',
    reasonCode: isPartial ? (params.callbackErrorCode ?? 'partial_exchange') : null,
    changes: {
      platform: { before: null, after: params.platform },
      status: { before: null, after: params.derivedStatus ?? 'active' },
    },
    ipHash: params.auditContext?.ipHash ?? null,
    userAgentSummary: params.auditContext?.userAgentSummary ?? null,
    correlationId: params.auditContext?.correlationId
      ? parseCorrelationId(params.auditContext.correlationId)
      : null,
    occurredAt: parseIsoTimestamp(params.now),
    createdAt: parseIsoTimestamp(params.now),
  });
}
