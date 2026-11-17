import type { DatabasePool } from '@affiliate-content-os/infrastructure/database';
import type { AIGatewayPort } from '@affiliate-content-os/application';
import { JobLeaseExpiredError } from '@affiliate-content-os/application';
import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';
import { settleComplianceReviewJobAtomic } from '@affiliate-content-os/infrastructure/workforce';
import {
  crossCheckCompliancePayload,
  parseAndValidateCompliancePayload,
  type ValidatedCompliancePayload,
} from './compliance-payload-validator.js';

export interface ComplianceJobProcessorDependencies {
  readonly workerId: string;
  readonly gatewayPort: AIGatewayPort;
  readonly pool: DatabasePool;
}

export async function processComplianceReviewJob(
  job: JobExecutionSnapshot,
  deps: ComplianceJobProcessorDependencies,
): Promise<void> {
  let payload: ValidatedCompliancePayload;
  try {
    payload = parseAndValidateCompliancePayload(job.payloadJson);
    crossCheckCompliancePayload(payload, job);
  } catch (_err) {
    const client = await deps.pool.connect();
    try {
      await client.query(
        `UPDATE job_executions
         SET status = 'failed', last_error_category = 'internal_error',
             completed_at = NOW(), updated_at = NOW(), version = version + 1
         WHERE id = $1 AND workspace_id = $2`,
        [job.id, job.workspaceId],
      );
    } finally {
      client.release();
    }
    return;
  }

  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');

    await settleComplianceReviewJobAtomic(client, deps.gatewayPort, {
      workspaceId: payload.workspaceId,
      jobId: job.id,
      jobVersion: job.version,
      workerId: deps.workerId,
      operationId: payload.operationId,
      aiRunId: payload.aiRunId,
      evaluationId: payload.evaluationId,
      productId: payload.productId,
      workOrderId: payload.workOrderId,
      artifactId: payload.artifactId,
      revisionNumber: payload.revisionNumber,
      policyVersion: payload.policyVersion,
    });

    await client.query('COMMIT');
  } catch (_err) {
    await client.query('ROLLBACK');

    if (_err instanceof JobLeaseExpiredError) {
      // Lease lost or expired: do not overwrite
      return;
    }

    // Fail job safely on error
    try {
      await client.query(
        `UPDATE job_executions
         SET status = 'failed', last_error_category = 'internal_error',
             completed_at = NOW(), updated_at = NOW(), version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND status = 'running'`,
        [job.id, job.workspaceId],
      );
    } catch {
      // Ignore fallback failure
    }
  } finally {
    client.release();
  }
}
