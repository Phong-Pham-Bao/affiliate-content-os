import type pg from 'pg';
import type { KickoffPersistenceSnapshot, KickoffTestHooks } from './workforce-types.js';

export async function insertKickoffPlanningJobs(
  client: pg.PoolClient,
  snapshot: KickoffPersistenceSnapshot,
  testHooks?: KickoffTestHooks,
): Promise<void> {
  const wsId = snapshot.workOrder.workspaceId;
  const prodId = snapshot.workOrder.productId;
  const workOrderId = snapshot.workOrder.id;
  const actorId = snapshot.workOrder.createdByUserId;

  for (const jobParam of snapshot.planningJobs) {
    // 1. Insert operation
    await client.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, progress_percent, result_location, error_category, error_code, error_message,
         requested_by_user_id, started_at, completed_at, created_at, updated_at, version,
         work_order_id, work_item_id
       ) VALUES (
         $1, $2, $3, 'product', $4,
         'queued', NULL, NULL, NULL, NULL, NULL,
         $5, NULL, NULL, NOW(), NOW(), 1,
         $6, $7
       )`,
      [
        jobParam.operationId,
        wsId,
        jobParam.taskKey,
        prodId,
        actorId,
        workOrderId,
        jobParam.workItemId,
      ],
    );

    // 2. Insert ai_run
    await client.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, output_hash, status, attempt, is_repair, token_input, token_output,
         cost_microunits, cost_currency, latency_ms, safety_result, error_category,
         requested_by_user_id, started_at, completed_at, created_at, updated_at, version,
         work_order_id, work_item_id
       ) VALUES (
         $1, $2, $3, $4, 'google', 'gemini-3.8-flash',
         $5, '1.0.0', 1, 1,
         $6, NULL, 'queued', 1, FALSE, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL,
         $7, NULL, NULL, NOW(), NOW(), 1,
         $8, $9
       )`,
      [
        jobParam.aiRunId,
        wsId,
        jobParam.operationId,
        jobParam.taskKey,
        jobParam.promptTemplate,
        snapshot.contextPackage.contextHashBuf,
        actorId,
        workOrderId,
        jobParam.workItemId,
      ],
    );

    // 3. Insert job_execution
    const jobPayload = {
      workspaceId: wsId,
      productId: prodId,
      workOrderId,
      workItemId: jobParam.workItemId,
      taskKey: jobParam.taskKey,
      roleKey: jobParam.roleKey,
      operationId: jobParam.operationId,
      aiRunId: jobParam.aiRunId,
      contextPackageId: snapshot.contextPackage.id,
      actorUserId: actorId,
      reservedMicrounits: jobParam.reservedMicrounits,
    };

    const dedupKey = `workforce:${workOrderId}:${jobParam.taskKey}`;

    await client.query(
      `INSERT INTO job_executions (
         id, workspace_id, operation_id, ai_run_id, job_type, deduplication_key,
         status, attempt, max_attempts, repair_attempt, max_repair_attempts,
         lease_owner, lease_expires_at, next_attempt_at, started_at, completed_at,
         last_error_category, payload_json, correlation_id, reserved_spend_microunits,
         created_at, updated_at, version, work_order_id, work_item_id
       ) VALUES (
         $1, $2, $3, $4, 'workforce_planning', $5,
         'queued', 0, 3, 0, 1,
         NULL, NULL, NOW(), NULL, NULL,
         NULL, $6::jsonb, NULL, $7,
         NOW(), NOW(), 1, $8, $9
       )`,
      [
        jobParam.jobId,
        wsId,
        jobParam.operationId,
        jobParam.aiRunId,
        dedupKey,
        JSON.stringify(jobPayload),
        jobParam.reservedMicrounits,
        workOrderId,
        jobParam.workItemId,
      ],
    );

    // 4. Insert outbox_event
    const outboxPayload = {
      workOrderId,
      workItemId: jobParam.workItemId,
      jobId: jobParam.jobId,
      roleKey: jobParam.roleKey,
      taskKey: jobParam.taskKey,
    };

    await client.query(
      `INSERT INTO outbox_events (
         id, workspace_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, occurred_at, available_at, delivery_count, created_at
       ) VALUES (
         $1, $2, 'workforce_planning.enqueued', 'work_order', $3,
         1, $4::jsonb, NOW(), NOW(), 0, NOW()
       )`,
      [jobParam.outboxId, wsId, workOrderId, JSON.stringify(outboxPayload)],
    );
  }

  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('planning_jobs');
  }
}
