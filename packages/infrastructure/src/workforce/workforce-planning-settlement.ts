import type pg from 'pg';
import { JobLeaseExpiredError } from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import type { WorkforcePlanningSettlementParams } from './workforce-planning-settlement-types.js';
import {
  handleSuccessSettlement,
  handleTerminalFailure,
  handleTransientFailure,
} from './workforce-planning-settlement-handlers.js';

export async function settleWorkforcePlanningJobAtomic(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
): Promise<{ artifactId?: string }> {
  // 1. Lease fencing check
  const jobRes = await client.query(
    `SELECT id, workspace_id, status, attempt, max_attempts, version, lease_owner,
            lease_expires_at, reserved_spend_microunits
     FROM job_executions
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [params.jobId, params.workspaceId],
  );

  if (jobRes.rowCount === 0 || !jobRes.rows[0]) {
    throw new DatabaseError(`Job execution not found: ${params.jobId}`);
  }
  const job = jobRes.rows[0];

  if (
    Number(job.version) !== params.jobVersion ||
    job.lease_owner !== params.workerId ||
    job.status !== 'running'
  ) {
    throw new JobLeaseExpiredError(params.jobId);
  }

  const reserved = Number(job.reserved_spend_microunits ?? params.reservedMicrounits);

  if (params.outcome.kind === 'success') {
    return handleSuccessSettlement(client, params, reserved);
  } else if (params.outcome.kind === 'transient_failure') {
    await handleTransientFailure(client, params);
    return {};
  } else {
    await handleTerminalFailure(client, params, reserved);
    return {};
  }
}

export type {
  WorkforcePlanningSettlementParams,
  WorkforceSuccessOutcome,
  WorkforceTerminalFailureOutcome,
  WorkforceTransientFailureOutcome,
} from './workforce-planning-settlement-types.js';
