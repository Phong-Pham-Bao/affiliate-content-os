import {
  parseAuditEventId,
  parseCorrelationId,
  parseIsoTimestamp,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  SocialAccountNotFoundError,
  SocialAccountVersionMismatchError,
  type DisconnectSocialAccountParams,
} from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
import type { Database } from '../../database/types.js';
import { mapSocialAccountRow, type SocialAccountRow } from './postgres-social-mappers.js';
import {
  SQL_DELETE_SOCIAL_CREDENTIALS,
  SQL_DISCONNECT_SOCIAL_ACCOUNT,
} from './postgres-social-lifecycle-statements.js';

export async function executeDisconnectSocialAccount(
  database: Database,
  params: DisconnectSocialAccountParams,
) {
  return database.withTransaction(async (tx) => {
    const updateRes = await tx.query<SocialAccountRow>(SQL_DISCONNECT_SOCIAL_ACCOUNT, [
      params.workspaceId,
      params.accountId,
      params.now,
      params.actorUserId,
      params.externalRevocationAttempted,
      params.externalRevocationSupported,
      params.externalRevocationResult,
      params.expectedVersion,
    ]);

    if (updateRes.rows.length === 0) {
      // Check whether it was already disconnected or version mismatch
      const checkRes = await tx.query<SocialAccountRow>(
        'SELECT * FROM social_accounts WHERE workspace_id = $1 AND id = $2 FOR UPDATE;',
        [params.workspaceId, params.accountId],
      );
      if (checkRes.rows.length === 0) {
        throw new SocialAccountNotFoundError();
      }
      const existing = checkRes.rows[0]!;
      if (existing.status === 'disconnected') {
        return mapSocialAccountRow(existing);
      }
      throw new SocialAccountVersionMismatchError(
        `Account version mismatch: expected ${params.expectedVersion}, found ${existing.version}`,
      );
    }

    // Cryptographically erase / delete usable credentials
    await tx.query(SQL_DELETE_SOCIAL_CREDENTIALS, [params.workspaceId, params.accountId]);

    // Audit disconnect event
    const audit = createTransactionScopedPostgresAuditAdapter(tx);
    await audit.appendAuditEvent({
      id: parseAuditEventId(generateUuidV7()),
      workspaceId: parseWorkspaceId(params.workspaceId),
      actorType: 'user',
      actorUserId: parseUserId(params.actorUserId),
      action: 'social_connection.disconnected',
      resourceType: 'social_account',
      resourceId: params.accountId,
      result: 'succeeded',
      reasonCode: null,
      changes: {
        status: { before: null, after: 'disconnected' },
        external_revocation_supported: {
          before: null,
          after: String(params.externalRevocationSupported),
        },
        external_revocation_result: { before: null, after: params.externalRevocationResult },
      },
      ipHash: params.auditContext?.ipHash ?? null,
      userAgentSummary: params.auditContext?.userAgentSummary ?? null,
      correlationId: params.auditContext?.correlationId
        ? parseCorrelationId(params.auditContext.correlationId)
        : null,
      occurredAt: parseIsoTimestamp(params.now),
      createdAt: parseIsoTimestamp(params.now),
    });

    return mapSocialAccountRow(updateRes.rows[0]!);
  });
}
