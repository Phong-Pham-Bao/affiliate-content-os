import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import type {
  WorkforcePlanningSettlementParams,
  WorkforceRepairOutcome,
  WorkforceTerminalFailureOutcome,
  WorkforceTransientFailureOutcome,
} from './workforce-planning-settlement-types.js';

export async function handleTransientFailure(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
): Promise<void> {
  const outcome = params.outcome as WorkforceTransientFailureOutcome;
  const jobUpdate = await client.query(
    `UPDATE job_executions
     SET status = 'retry_wait', next_attempt_at = $1, lease_owner = NULL,
         lease_expires_at = NULL, last_error_category = $2, updated_at = NOW(), version = version + 1
     WHERE id = $3 AND workspace_id = $4 AND version = $5 AND status = 'running' AND lease_owner = $6`,
    [
      outcome.nextAttemptAt,
      outcome.errorCategory,
      params.jobId,
      params.workspaceId,
      params.jobVersion,
      params.workerId,
    ],
  );
  if (jobUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to schedule transient retry for job execution ${params.jobId}`);
  }
}

export async function handleRepairSettlement(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
): Promise<void> {
  const outcome = params.outcome as WorkforceRepairOutcome;
  const jobUpdate = await client.query(
    `UPDATE job_executions
     SET status = 'retry_wait',
         repair_attempt = repair_attempt + 1,
         next_attempt_at = NOW() + ($1 || ' seconds')::INTERVAL,
         last_error_category = $2,
         lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $3 AND workspace_id = $4 AND version = $5 AND status = 'running' AND lease_owner = $6
       AND repair_attempt < max_repair_attempts`,
    [
      outcome.repairDelaySeconds,
      outcome.errorCategory,
      params.jobId,
      params.workspaceId,
      params.jobVersion,
      params.workerId,
    ],
  );
  if (jobUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to schedule repair attempt for job execution ${params.jobId}`);
  }

  const runUpdate = await client.query(
    `UPDATE ai_runs
     SET is_repair = TRUE, updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
    [params.aiRunId, params.workspaceId],
  );
  if (runUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to mark AI run ${params.aiRunId} as repair`);
  }
}

export async function handleTerminalFailure(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
  reserved: number,
): Promise<void> {
  const outcome = params.outcome as WorkforceTerminalFailureOutcome;

  const jobUpdate = await client.query(
    `UPDATE job_executions
     SET status = 'failed', completed_at = NOW(), lease_owner = NULL,
         lease_expires_at = NULL, last_error_category = $1, updated_at = NOW(), version = version + 1
     WHERE id = $2 AND workspace_id = $3 AND version = $4 AND status = 'running' AND lease_owner = $5`,
    [outcome.errorCategory, params.jobId, params.workspaceId, params.jobVersion, params.workerId],
  );
  if (jobUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update job execution ${params.jobId} to failed`);
  }

  const opUpdate = await client.query(
    `UPDATE operations
     SET status = 'failed', error_category = $1, error_code = $2, error_message = $3,
         completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $4 AND workspace_id = $5 AND status IN ('queued', 'running', 'pending')`,
    [
      outcome.errorCategory,
      outcome.errorCode ?? 'FAILED',
      outcome.errorMessage,
      params.operationId,
      params.workspaceId,
    ],
  );
  if (opUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update operation ${params.operationId} to failed`);
  }

  const runUpdate = await client.query(
    `UPDATE ai_runs
     SET status = 'failed', error_category = $1, completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
    [outcome.errorCategory, params.aiRunId, params.workspaceId],
  );
  if (runUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update AI run ${params.aiRunId} to failed`);
  }

  if (reserved > 0) {
    const policyUpdate = await client.query(
      `UPDATE workspace_ai_policies
       SET reserved_spend_microunits = reserved_spend_microunits - $1,
           updated_at = NOW(), version = version + 1
       WHERE workspace_id = $2 AND reserved_spend_microunits >= $1`,
      [reserved, params.workspaceId],
    );
    if (policyUpdate.rowCount !== 1) {
      throw new DatabaseError(
        `Failed to release workspace AI policy reservation: insufficient reserved spend in workspace ${params.workspaceId}`,
      );
    }
  }

  const wiUpdate = await client.query(
    `UPDATE work_items
     SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND work_order_id = $3 AND status IN ('queued', 'running')`,
    [params.workItemId, params.workspaceId, params.workOrderId],
  );
  if (wiUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update work item ${params.workItemId} to failed`);
  }

  if (params.assignmentId) {
    const asgUpdate = await client.query(
      `UPDATE agent_assignments
       SET office_state = 'failed', updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND work_order_id = $3`,
      [params.assignmentId, params.workspaceId, params.workOrderId],
    );
    if (asgUpdate.rowCount !== 1) {
      throw new DatabaseError(`Failed to update agent assignment ${params.assignmentId} to failed`);
    }
  }

  const woUpdate = await client.query(
    `UPDATE work_orders
     SET status = 'failed', failure_category = $1, completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $2 AND workspace_id = $3 AND status IN ('in_progress', 'failed')`,
    [outcome.errorCategory, params.workOrderId, params.workspaceId],
  );
  if (woUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update work order ${params.workOrderId} to failed`);
  }

  const safeReasonCode = outcome.errorCode
    ? outcome.errorCode.toLowerCase().replace(/[^a-z0-9_.]/g, '_')
    : 'artifact_failed';

  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, reason_code, changes_json, occurred_at, created_at
     ) VALUES ($1, $2, 'system', NULL, 'artifact.failed', 'work_item', $3, 'failed', $4, $5::jsonb, NOW(), NOW())`,
    [
      generateUuidV7(),
      params.workspaceId,
      params.workItemId,
      safeReasonCode,
      JSON.stringify({
        workOrderId: params.workOrderId,
        errorCategory: outcome.errorCategory,
        errorMessage: outcome.errorMessage,
      }),
    ],
  );
}
