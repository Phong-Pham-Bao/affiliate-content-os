import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import type {
  WorkforcePlanningSettlementParams,
  WorkforceSuccessOutcome,
} from './workforce-planning-settlement-types.js';
import { persistContentArtifactAndRevision } from './workforce-planning-artifact-persistence.js';
import { prepareAndEnqueueScriptwritingStage } from './workforce-scriptwriting-kickoff.js';

export {
  handleTransientFailure,
  handleRepairSettlement,
  handleTerminalFailure,
} from './workforce-planning-failure-handlers.js';

export async function handleSuccessSettlement(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
  reserved: number,
): Promise<{ artifactId: string }> {
  const outcome = params.outcome as WorkforceSuccessOutcome;

  // 1. Validate actual cost strictly: must be safe non-negative integer <= reserved
  const actualCost = outcome.usage.costMicrounits ?? 0;
  if (
    typeof actualCost !== 'number' ||
    actualCost < 0 ||
    !Number.isSafeInteger(actualCost) ||
    actualCost > reserved
  ) {
    throw new DatabaseError(
      `Invalid actual cost: must be safe non-negative integer <= reserved amount (${reserved})`,
    );
  }

  // 2. Persist content_artifacts, content_artifact_revisions, artifact_evidence_refs
  const { artifactId, revisionNumber } = await persistContentArtifactAndRevision(
    client,
    params,
    outcome,
  );

  // 3. Settle budget in workspace_ai_policies first
  const policyUpdate = await client.query(
    `UPDATE workspace_ai_policies
     SET reserved_spend_microunits = reserved_spend_microunits - $1,
         current_spend_microunits = current_spend_microunits + $2,
         updated_at = NOW(), version = version + 1
     WHERE workspace_id = $3 AND reserved_spend_microunits >= $1`,
    [reserved, actualCost, params.workspaceId],
  );
  if (policyUpdate.rowCount !== 1) {
    throw new DatabaseError(
      `Failed to settle workspace AI policy reservation: insufficient reserved spend in workspace ${params.workspaceId}`,
    );
  }

  // 4. Update job_executions to succeeded
  const jobUpdate = await client.query(
    `UPDATE job_executions
     SET status = 'succeeded', completed_at = NOW(), lease_owner = NULL,
         lease_expires_at = NULL, last_error_category = NULL, updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND version = $3 AND status = 'running' AND lease_owner = $4`,
    [params.jobId, params.workspaceId, params.jobVersion, params.workerId],
  );
  if (jobUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update job execution ${params.jobId} to succeeded`);
  }

  // 5. Update operations to succeeded
  const opUpdate = await client.query(
    `UPDATE operations
     SET status = 'succeeded', result_location = $1, completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running', 'pending')`,
    [
      `/workspaces/${params.workspaceId}/artifacts/${artifactId}`,
      params.operationId,
      params.workspaceId,
    ],
  );
  if (opUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update operation ${params.operationId} to succeeded`);
  }

  // 6. Update ai_runs to succeeded
  const runUpdate = await client.query(
    `UPDATE ai_runs
     SET status = 'succeeded', output_hash = $1, token_input = $2, token_output = $3,
         cost_microunits = $4, cost_currency = $5, latency_ms = $6, completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $7 AND workspace_id = $8 AND status IN ('queued', 'running')`,
    [
      Buffer.from(outcome.contentHash),
      outcome.usage.tokenInput ?? null,
      outcome.usage.tokenOutput ?? null,
      outcome.usage.costMicrounits ?? null,
      outcome.usage.costCurrency ?? 'USD',
      outcome.usage.latencyMs ?? null,
      params.aiRunId,
      params.workspaceId,
    ],
  );
  if (runUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update AI run ${params.aiRunId} to succeeded`);
  }

  // 7. Update work_items to completed
  const wiUpdate = await client.query(
    `UPDATE work_items
     SET status = 'completed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND work_order_id = $3 AND status IN ('queued', 'running')`,
    [params.workItemId, params.workspaceId, params.workOrderId],
  );
  if (wiUpdate.rowCount !== 1) {
    throw new DatabaseError(`Failed to update work item ${params.workItemId} to completed`);
  }

  // 8. Update agent_assignments to completed
  const asgUpdate = await client.query(
    `UPDATE agent_assignments
     SET office_state = 'completed', updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND work_order_id = $3`,
    [params.assignmentId, params.workspaceId, params.workOrderId],
  );
  if (asgUpdate.rowCount !== 1) {
    throw new DatabaseError(
      `Failed to update agent assignment ${params.assignmentId} to completed`,
    );
  }

  // 9. Dependency release check: check if all 3 planning items are completed
  const planningStatusRes = await client.query(
    `SELECT
       count(*) FILTER (WHERE status = 'completed') AS completed_count,
       count(*) FILTER (WHERE status <> 'completed') AS non_completed_count
     FROM work_items
     WHERE workspace_id = $1 AND work_order_id = $2
       AND task_key IN ('product_strategy', 'audience_strategy', 'creative_direction')`,
    [params.workspaceId, params.workOrderId],
  );

  const completedCount = Number(planningStatusRes.rows[0]?.completed_count ?? 0);
  const nonCompletedCount = Number(planningStatusRes.rows[0]?.non_completed_count ?? 0);
  if (completedCount === 3 && nonCompletedCount === 0) {
    await prepareAndEnqueueScriptwritingStage(client, {
      workspaceId: params.workspaceId,
      productId: params.productId,
      workOrderId: params.workOrderId,
    });
  }

  // 10. Insert audit event
  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, changes_json, occurred_at, created_at
     ) VALUES ($1, $2, 'system', NULL, 'artifact.created', 'content_artifact', $3, 'succeeded', $4::jsonb, NOW(), NOW())`,
    [
      generateUuidV7(),
      params.workspaceId,
      artifactId,
      JSON.stringify({
        workOrderId: params.workOrderId,
        workItemId: params.workItemId,
        artifactType: params.artifactType,
        revisionNumber,
      }),
    ],
  );

  return { artifactId };
}
