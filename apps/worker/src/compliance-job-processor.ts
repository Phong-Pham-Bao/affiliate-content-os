import type { DatabasePool } from '@affiliate-content-os/infrastructure/database';
import type {
  AIGatewayPort,
  ExecuteComplianceAdvisoryResult,
} from '@affiliate-content-os/application';
import { JobLeaseExpiredError } from '@affiliate-content-os/application';
import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';
import {
  prepareComplianceReviewExecution,
  settleComplianceBudgetExhaustedAtomic,
  settleComplianceDriftAtomic,
  settleCompliancePreflightBlockerAtomic,
  settleComplianceReviewExecutionAtomic,
} from '@affiliate-content-os/infrastructure/workforce';
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

  const baseParams = {
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
    expectedContentHashHex: payload.contentHashHex,
  };

  // 1. Prepare stage (Pre-provider drift & validation checks)
  const prepClient = await deps.pool.connect();
  let prep;
  try {
    prep = await prepareComplianceReviewExecution(prepClient, baseParams);
  } catch (err) {
    prepClient.release();
    if (err instanceof JobLeaseExpiredError) {
      return;
    }
    throw err;
  }

  if (prep.kind === 'already_terminal') {
    prepClient.release();
    return;
  }

  if (prep.kind === 'drift_detected') {
    try {
      await prepClient.query('BEGIN');
      await settleComplianceDriftAtomic(prepClient, {
        ...baseParams,
        reason: prep.reason,
        reservedSpend: prep.reservedSpend,
      });
      await prepClient.query('COMMIT');
    } catch (err) {
      await prepClient.query('ROLLBACK');
      if (err instanceof JobLeaseExpiredError) return;
      throw err;
    } finally {
      prepClient.release();
    }
    return;
  }

  if (prep.kind === 'preflight_blocked') {
    try {
      await prepClient.query('BEGIN');
      await settleCompliancePreflightBlockerAtomic(prepClient, {
        ...baseParams,
        deterministicResult: prep.deterministicResult,
        scriptContent: prep.scriptContent,
        contentHashHex: prep.contentHashHex,
        reservedSpend: prep.reservedSpend,
      });
      await prepClient.query('COMMIT');
    } catch (err) {
      await prepClient.query('ROLLBACK');
      if (err instanceof JobLeaseExpiredError) return;
      throw err;
    } finally {
      prepClient.release();
    }
    return;
  }

  if (prep.kind === 'budget_exhausted') {
    try {
      await prepClient.query('BEGIN');
      await settleComplianceBudgetExhaustedAtomic(prepClient, {
        ...baseParams,
        deterministicResult: prep.deterministicResult,
        productId: payload.productId,
        artifactId: payload.artifactId,
        revisionNumber: payload.revisionNumber,
      });
      await prepClient.query('COMMIT');
    } catch (err) {
      await prepClient.query('ROLLBACK');
      if (err instanceof JobLeaseExpiredError) return;
      throw err;
    } finally {
      prepClient.release();
    }
    return;
  }

  // Release client before network provider call!
  prepClient.release();

  // 2. Network provider call (NO client connection held, NO locks, NO transaction)
  let advisoryRes: ExecuteComplianceAdvisoryResult | null;
  try {
    advisoryRes = await deps.gatewayPort.executeComplianceAdvisory(prep.providerInput);
  } catch {
    advisoryRes = null;
  }

  // 3. Settlement stage (Post-provider drift fencing & atomic settlement)
  const settleClient = await deps.pool.connect();
  try {
    await settleClient.query('BEGIN');
    await settleComplianceReviewExecutionAtomic(settleClient, {
      ...baseParams,
      contentHashHex: prep.contentHashHex,
      deterministicResult: prep.deterministicResult,
      reservedSpend: prep.reservedSpend,
      policyVersion: prep.policyVersion,
      policyHashHex: prep.policyHashHex,
      providerResult: advisoryRes,
    });
    await settleClient.query('COMMIT');
  } catch (err) {
    await settleClient.query('ROLLBACK');
    if (err instanceof JobLeaseExpiredError) {
      return;
    }
    try {
      await settleClient.query(
        `UPDATE job_executions
         SET status = 'failed', last_error_category = 'internal_error',
             completed_at = NOW(), updated_at = NOW(), version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND status = 'running'`,
        [job.id, job.workspaceId],
      );
    } catch {
      // Ignore fallback failure
    }
    throw err;
  } finally {
    settleClient.release();
  }
}
