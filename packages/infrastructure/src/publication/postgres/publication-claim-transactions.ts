import {
  parseAuditEventId,
  parseIsoTimestamp,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  type ClaimDuePublicationsParams,
  type ClaimedPublication,
  type LeaseRecoveryResult,
  type RecoverExpiredLeasesParams,
} from '@affiliate-content-os/application';
import { createTransactionScopedPostgresAuditAdapter } from '../../audit/index.js';
import type { Database } from '../../database/types.js';
import {
  SQL_CLAIM_DUE_PUBLICATIONS,
  SQL_FIND_EXPIRED_LEASE_PUBLICATIONS,
  SQL_FIND_LATEST_ATTEMPT_FOR_PUBLICATION,
} from './postgres-publication-statements.js';
import {
  mapPublicationRow,
  type PublicationAttemptRow,
  type PublicationRow,
} from './postgres-publication-mappers.js';

export async function executeClaimDuePublications(
  database: Database,
  params: ClaimDuePublicationsParams,
): Promise<readonly ClaimedPublication[]> {
  const batchSize = Math.min(Math.max(1, params.maxBatchSize), 50);
  const leaseSecs = Math.min(Math.max(10, params.leaseDurationSeconds), 600);

  const result = await database.query<PublicationRow>(SQL_CLAIM_DUE_PUBLICATIONS, [
    batchSize,
    params.workerId,
    leaseSecs,
  ]);

  return result.rows.map((row) => ({
    publication: mapPublicationRow(row),
    leaseToken: row.lease_token!,
  }));
}

export async function executeRecoverExpiredLeases(
  database: Database,
  _params: RecoverExpiredLeasesParams,
): Promise<LeaseRecoveryResult> {
  return database.withTransaction(async (tx) => {
    const expiredRes = await tx.query<{
      id: string;
      workspace_id: string;
      version: string | number;
      status: string;
      current_attempt_number: number;
    }>(SQL_FIND_EXPIRED_LEASE_PUBLICATIONS, [50]);

    let reclaimedCount = 0;
    let markedUnknownCount = 0;

    for (const pub of expiredRes.rows) {
      // Find latest attempt for this publication
      const attemptRes = await tx.query<PublicationAttemptRow>(
        SQL_FIND_LATEST_ATTEMPT_FOR_PUBLICATION,
        [pub.workspace_id, pub.id],
      );
      const latestAttempt = attemptRes.rows[0];

      if (latestAttempt && latestAttempt.phase === 'provider_attempt_started') {
        // Provider call may have executed: transition attempt & publication to outcome_unknown
        await tx.query(
          `UPDATE publication_attempts
           SET phase = 'terminal', status = 'outcome_unknown',
               outcome_code = 'LEASE_EXPIRED_DURING_EXECUTION',
               outcome_message = 'Worker lease expired while provider attempt was started',
               completed_at = NOW(), version = version + 1, updated_at = NOW()
           WHERE workspace_id = $1 AND id = $2 AND phase = 'provider_attempt_started'`,
          [pub.workspace_id, latestAttempt.id],
        );

        await tx.query(
          `UPDATE publications
           SET status = 'outcome_unknown',
               last_error_code = 'LEASE_EXPIRED_DURING_EXECUTION',
               last_error_message = 'Worker lease expired while provider attempt was started',
               completed_at = NOW(), lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
               version = version + 1, updated_at = NOW()
          WHERE workspace_id = $1 AND id = $2`,
          [pub.workspace_id, pub.id],
        );

        const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
        await auditAdapter.appendAuditEvent({
          id: parseAuditEventId(generateUuidV7()),
          workspaceId: parseWorkspaceId(pub.workspace_id),
          actorType: 'system',
          actorUserId: null,
          action: 'publication.outcome_unknown',
          resourceType: 'publication',
          resourceId: pub.id,
          result: 'succeeded',
          reasonCode: 'LEASE_EXPIRED_DURING_EXECUTION',
          changes: { status: { before: pub.status, after: 'outcome_unknown' } },
          ipHash: null,
          userAgentSummary: null,
          correlationId: null,
          occurredAt: parseIsoTimestamp(new Date().toISOString()),
          createdAt: parseIsoTimestamp(new Date().toISOString()),
        });

        markedUnknownCount++;
      } else {
        // Pre-call expiration: release lease and return to scheduled or retry_wait
        const newStatus = Number(pub.current_attempt_number) === 0 ? 'scheduled' : 'retry_wait';
        await tx.query(
          `UPDATE publications
           SET status = $1, lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
               version = version + 1, updated_at = NOW()
           WHERE workspace_id = $2 AND id = $3`,
          [newStatus, pub.workspace_id, pub.id],
        );
        reclaimedCount++;
      }
    }

    return { reclaimedCount, markedUnknownCount };
  });
}
