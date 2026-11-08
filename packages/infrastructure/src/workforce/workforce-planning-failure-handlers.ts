import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import type {
  WorkforcePlanningSettlementParams,
  WorkforceTerminalFailureOutcome,
  WorkforceTransientFailureOutcome,
} from './workforce-planning-settlement-types.js';

export async function handleTransientFailure(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
): Promise<void> {
  const outcome = params.outcome as WorkforceTransientFailureOutcome;
  await client.query(
    `UPDATE job_executions
     SET status = 'retry_wait', next_attempt_at = $1, lease_owner = NULL,
         lease_expires_at = NULL, last_error_category = $2, updated_at = NOW(), version = version + 1
     WHERE id = $3`,
    [outcome.nextAttemptAt, outcome.errorCategory, params.jobId],
  );
}

export async function handleTerminalFailure(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
  reserved: number,
): Promise<void> {
  const outcome = params.outcome as WorkforceTerminalFailureOutcome;

  await client.query(
    `UPDATE job_executions
     SET status = 'failed', completed_at = NOW(), lease_owner = NULL,
         lease_expires_at = NULL, last_error_category = $1, updated_at = NOW(), version = version + 1
     WHERE id = $2`,
    [outcome.errorCategory, params.jobId],
  );

  await client.query(
    `UPDATE operations
     SET status = 'failed', error_category = $1, error_code = $2, error_message = $3,
         completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $4`,
    [
      outcome.errorCategory,
      outcome.errorCode ?? 'FAILED',
      outcome.errorMessage,
      params.operationId,
    ],
  );

  await client.query(
    `UPDATE ai_runs
     SET status = 'failed', error_category = $1, completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $2`,
    [outcome.errorCategory, params.aiRunId],
  );

  await client.query(
    `UPDATE workspace_ai_policies
     SET reserved_spend_microunits = reserved_spend_microunits - $1,
         updated_at = NOW(), version = version + 1
     WHERE workspace_id = $2 AND reserved_spend_microunits >= $1`,
    [reserved, params.workspaceId],
  );

  await client.query(
    `UPDATE work_items
     SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1`,
    [params.workItemId],
  );

  await client.query(
    `UPDATE agent_assignments
     SET office_state = 'failed', updated_at = NOW(), version = version + 1
     WHERE id = $1`,
    [params.assignmentId],
  );

  await client.query(
    `UPDATE work_orders
     SET status = 'failed', failure_category = $1, completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $2`,
    [outcome.errorCategory, params.workOrderId],
  );

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
