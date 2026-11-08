import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import type {
  WorkforcePlanningSettlementParams,
  WorkforceSuccessOutcome,
} from './workforce-planning-settlement-types.js';
import { persistContentArtifactAndRevision } from './workforce-planning-artifact-persistence.js';

export {
  handleTransientFailure,
  handleTerminalFailure,
} from './workforce-planning-failure-handlers.js';

export async function handleSuccessSettlement(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
  reserved: number,
): Promise<{ artifactId: string }> {
  const outcome = params.outcome as WorkforceSuccessOutcome;

  // 1-3. Persist content_artifacts, content_artifact_revisions, artifact_evidence_refs
  const { artifactId, revisionNumber } = await persistContentArtifactAndRevision(
    client,
    params,
    outcome,
  );

  // 4. Update job_executions to succeeded
  await client.query(
    `UPDATE job_executions
     SET status = 'succeeded', completed_at = NOW(), lease_owner = NULL,
         lease_expires_at = NULL, last_error_category = NULL, updated_at = NOW(), version = version + 1
     WHERE id = $1`,
    [params.jobId],
  );

  // 5. Update operations to succeeded
  await client.query(
    `UPDATE operations
     SET status = 'succeeded', result_location = $1, completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $2`,
    [`/workspaces/${params.workspaceId}/artifacts/${artifactId}`, params.operationId],
  );

  // 6. Update ai_runs to succeeded
  await client.query(
    `UPDATE ai_runs
     SET status = 'succeeded', output_hash = $1, token_input = $2, token_output = $3,
         cost_microunits = $4, cost_currency = $5, latency_ms = $6, completed_at = NOW(),
         updated_at = NOW(), version = version + 1
     WHERE id = $7`,
    [
      Buffer.from(outcome.contentHash),
      outcome.usage.tokenInput ?? null,
      outcome.usage.tokenOutput ?? null,
      outcome.usage.costMicrounits ?? null,
      outcome.usage.costCurrency ?? 'USD',
      outcome.usage.latencyMs ?? null,
      params.aiRunId,
    ],
  );

  // 7. Settle budget in workspace_ai_policies
  const actualCost = outcome.usage.costMicrounits ?? 0;
  await client.query(
    `UPDATE workspace_ai_policies
     SET reserved_spend_microunits = reserved_spend_microunits - $1,
         current_spend_microunits = current_spend_microunits + $2,
         updated_at = NOW(), version = version + 1
     WHERE workspace_id = $3 AND reserved_spend_microunits >= $1`,
    [reserved, actualCost, params.workspaceId],
  );

  // 8. Update work_items to completed
  await client.query(
    `UPDATE work_items
     SET status = 'completed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1`,
    [params.workItemId],
  );

  // 9. Update agent_assignments to completed
  await client.query(
    `UPDATE agent_assignments
     SET office_state = 'completed', updated_at = NOW(), version = version + 1
     WHERE id = $1`,
    [params.assignmentId],
  );

  // 10. Dependency release check: check if all 3 planning items are completed
  const remainingRes = await client.query(
    `SELECT count(*) AS remaining
     FROM work_items
     WHERE work_order_id = $1
       AND task_key IN ('product_strategy', 'audience_strategy', 'creative_direction')
       AND status <> 'completed'`,
    [params.workOrderId],
  );

  const remaining = Number(remainingRes.rows[0]?.remaining ?? 0);
  if (remaining === 0) {
    await client.query(
      `UPDATE work_items
       SET status = 'ready', updated_at = NOW(), version = version + 1
       WHERE work_order_id = $1 AND task_key = 'scriptwriting' AND status = 'waiting_dependency'`,
      [params.workOrderId],
    );
    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'preparing', waiting_on_work_item_id = NULL, updated_at = NOW(), version = version + 1
       WHERE work_order_id = $1 AND work_item_id = (
         SELECT id FROM work_items WHERE work_order_id = $1 AND task_key = 'scriptwriting'
       )`,
      [params.workOrderId],
    );
  }

  // 11. Audit event
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
