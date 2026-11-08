import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import { synthesizeAndPersistContentBrief } from './workforce-content-brief.js';

export const SCRIPT_UNIT_COST_MICROUNITS = 10_000;

export async function prepareAndEnqueueScriptwritingStage(
  client: pg.PoolClient,
  params: {
    readonly workspaceId: string;
    readonly productId: string;
    readonly workOrderId: string;
  },
): Promise<void> {
  const { workspaceId, productId, workOrderId } = params;

  // 1. Synthesize content brief
  const { briefHash } = await synthesizeAndPersistContentBrief(client, workspaceId, workOrderId);

  // 2. Fetch scriptwriting work item, assignment, and work order creator
  const itemRes = await client.query(
    `SELECT w.id AS item_id, a.id AS assignment_id, wo.created_by_user_id
     FROM work_items w
     JOIN agent_assignments a
       ON a.work_item_id = w.id
      AND a.workspace_id = w.workspace_id
      AND a.work_order_id = w.work_order_id
     JOIN work_orders wo
       ON wo.id = w.work_order_id
      AND wo.workspace_id = w.workspace_id
     WHERE w.workspace_id = $1 AND w.work_order_id = $2 AND w.task_key = 'scriptwriting'
     FOR UPDATE OF w, a`,
    [workspaceId, workOrderId],
  );

  if (itemRes.rowCount === 0 || !itemRes.rows[0]) {
    return;
  }
  const {
    item_id: workItemId,
    assignment_id: assignmentId,
    created_by_user_id: actorId,
  } = itemRes.rows[0];

  // 3. Idempotency check: if 5 units already enqueued, do nothing
  const existingUnitsRes = await client.query(
    `SELECT count(*) AS count FROM script_generation_units
     WHERE workspace_id = $1 AND work_order_id = $2 AND change_request_id IS NULL`,
    [workspaceId, workOrderId],
  );
  if (Number(existingUnitsRes.rows[0]?.count ?? 0) >= 5) {
    return;
  }

  // 4. Budget check & reservation
  const totalReservation = 5 * SCRIPT_UNIT_COST_MICROUNITS;
  const policyRes = await client.query(
    `SELECT monthly_budget_microunits, current_spend_microunits, reserved_spend_microunits
     FROM workspace_ai_policies
     WHERE workspace_id = $1
     FOR UPDATE`,
    [workspaceId],
  );

  if (policyRes.rowCount === 0 || !policyRes.rows[0]) {
    await markScriptwritingBlocked(client, workspaceId, workOrderId, workItemId, assignmentId);
    return;
  }

  const policy = policyRes.rows[0];
  const budget = Number(policy.monthly_budget_microunits);
  const spend = Number(policy.current_spend_microunits);
  const reserved = Number(policy.reserved_spend_microunits);

  if (spend + reserved + totalReservation > budget) {
    await markScriptwritingBlocked(client, workspaceId, workOrderId, workItemId, assignmentId);
    return;
  }

  // Reserve budget
  await client.query(
    `UPDATE workspace_ai_policies
     SET reserved_spend_microunits = reserved_spend_microunits + $1,
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $2`,
    [totalReservation, workspaceId],
  );

  // 5. Enqueue 5 script units
  for (let videoNumber = 1; videoNumber <= 5; videoNumber++) {
    const opId = generateUuidV7();
    const aiRunId = generateUuidV7();
    const jobId = generateUuidV7();
    const unitId = generateUuidV7();
    const dedupKey = `${workOrderId}:scriptwriting:video:${videoNumber}`;

    await client.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, progress_percent, result_location, error_category, error_code, error_message,
         requested_by_user_id, started_at, completed_at, created_at, updated_at, version,
         work_order_id, work_item_id
       ) VALUES (
         $1, $2, 'scriptwriting', 'product', $3,
         'queued', NULL, NULL, NULL, NULL, NULL,
         $4, NULL, NULL, NOW(), NOW(), 1,
         $5, $6
       )`,
      [opId, workspaceId, productId, actorId, workOrderId, workItemId],
    );

    await client.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, output_hash, status, attempt, is_repair, token_input, token_output,
         cost_microunits, cost_currency, latency_ms, safety_result, error_category,
         requested_by_user_id, started_at, completed_at, created_at, updated_at, version,
         work_order_id, work_item_id
       ) VALUES (
         $1, $2, $3, 'scriptwriting', 'google', 'gemini-3.8-flash',
         'scriptwriting', '1.0.0', 1, 1,
         $4, NULL, 'queued', 1, FALSE, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL,
         $5, NULL, NULL, NOW(), NOW(), 1,
         $6, $7
       )`,
      [aiRunId, workspaceId, opId, Buffer.from(briefHash), actorId, workOrderId, workItemId],
    );

    const payload = {
      workspaceId,
      productId,
      workOrderId,
      workItemId,
      assignmentId,
      videoNumber,
      targetVariantCount: 1,
      reservedMicrounits: SCRIPT_UNIT_COST_MICROUNITS,
      briefHash: Buffer.from(briefHash).toString('hex'),
      operationId: opId,
      aiRunId,
    };

    await client.query(
      `INSERT INTO job_executions (
         id, workspace_id, operation_id, ai_run_id, job_type, deduplication_key,
         status, attempt, max_attempts, repair_attempt, max_repair_attempts,
         lease_owner, lease_expires_at, next_attempt_at, started_at, completed_at,
         last_error_category, payload_json, correlation_id, reserved_spend_microunits,
         work_order_id, work_item_id, created_at, updated_at, version
       ) VALUES (
         $1, $2, $3, $4, 'scriptwriting', $5,
         'queued', 0, 3, 0, 1,
         NULL, NULL, NOW(), NULL, NULL,
         NULL, $6::jsonb, NULL, $7,
         $8, $9, NOW(), NOW(), 1
       )`,
      [
        jobId,
        workspaceId,
        opId,
        aiRunId,
        dedupKey,
        JSON.stringify(payload),
        SCRIPT_UNIT_COST_MICROUNITS,
        workOrderId,
        workItemId,
      ],
    );

    await client.query(
      `INSERT INTO script_generation_units (
         id, workspace_id, work_order_id, work_item_id, video_number,
         target_variant_count, change_request_id, status, operation_id,
         ai_run_id, job_id, brief_hash, output_json, content_hash,
         error_category, error_message, created_at, updated_at, version
       ) VALUES (
         $1, $2, $3, $4, $5,
         1, NULL, 'queued', $6,
         $7, $8, $9, NULL, NULL,
         NULL, NULL, NOW(), NOW(), 1
       )`,
      [
        unitId,
        workspaceId,
        workOrderId,
        workItemId,
        videoNumber,
        opId,
        aiRunId,
        jobId,
        Buffer.from(briefHash),
      ],
    );
  }

  // 6. Update work_items & agent_assignments
  await client.query(
    `UPDATE work_items
     SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [workItemId, workspaceId],
  );

  await client.query(
    `UPDATE agent_assignments
     SET office_state = 'running', waiting_on_work_item_id = NULL, updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [assignmentId, workspaceId],
  );
}

async function markScriptwritingBlocked(
  client: pg.PoolClient,
  workspaceId: string,
  workOrderId: string,
  workItemId: string,
  assignmentId: string,
): Promise<void> {
  await client.query(
    `UPDATE work_items
     SET status = 'blocked', blocked_reason_code = 'insufficient_budget', updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [workItemId, workspaceId],
  );

  await client.query(
    `UPDATE agent_assignments
     SET office_state = 'blocked', updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [assignmentId, workspaceId],
  );

  await client.query(
    `UPDATE work_orders
     SET status = 'blocked', failure_category = 'insufficient_budget', updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status = 'in_progress'`,
    [workOrderId, workspaceId],
  );
}
