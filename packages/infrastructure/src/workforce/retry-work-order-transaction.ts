import type pg from 'pg';
import { parseWorkItemId, type WorkItemId } from '@affiliate-content-os/domain';
import type {
  RetryWorkOrderPlanningAtomicParams,
  RetryWorkOrderPlanningResult,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import { mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';

export async function executeRetryWorkOrderTransaction(
  client: pg.PoolClient,
  params: RetryWorkOrderPlanningAtomicParams,
): Promise<RetryWorkOrderPlanningResult> {
  const { workspaceId, workOrderId, actorUserId, retryItems } = params;

  // 1. Lock and check work order
  const woRes = await client.query(
    `SELECT * FROM work_orders WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, workOrderId],
  );
  if (woRes.rowCount === 0) {
    throw new DatabaseError(`Work order ${workOrderId} not found in workspace ${workspaceId}`);
  }
  const woRow = woRes.rows[0];

  // 2. Query failed planning items to retry
  const failedItemsRes = await client.query(
    `SELECT id, task_key FROM work_items
     WHERE workspace_id = $1 AND work_order_id = $2
       AND task_key IN ('product_strategy', 'audience_strategy', 'creative_direction')
       AND status = 'failed'
     FOR UPDATE`,
    [workspaceId, workOrderId],
  );

  if (failedItemsRes.rowCount === 0) {
    return {
      workOrder: mapWorkOrderRowToSummaryDTO(woRow),
      retriedItemIds: [],
      cached: false,
    };
  }

  const failedTaskMap = new Map<string, string>();
  for (const r of failedItemsRes.rows) {
    failedTaskMap.set(r.task_key, r.id);
  }

  // Filter retry items matching actually failed items
  const activeRetryItems = retryItems.filter((item) => failedTaskMap.has(item.taskKey));
  if (activeRetryItems.length === 0) {
    return {
      workOrder: mapWorkOrderRowToSummaryDTO(woRow),
      retriedItemIds: [],
      cached: false,
    };
  }

  const reservationCost = activeRetryItems.reduce((acc, i) => acc + i.reservedMicrounits, 0);

  // 3. AI Policy & Budget validation under lock
  const policyRes = await client.query(
    `SELECT ai_enabled, rate_limit_per_minute, minute_request_count,
            monthly_budget_microunits, current_spend_microunits,
            reserved_spend_microunits
     FROM workspace_ai_policies
     WHERE workspace_id = $1
     FOR UPDATE`,
    [workspaceId],
  );

  if (policyRes.rowCount === 0 || !policyRes.rows[0].ai_enabled) {
    throw new DatabaseError(`AI policy is disabled or missing for workspace ${workspaceId}`);
  }
  const policy = policyRes.rows[0];

  const currentMinuteCount = Number(policy.minute_request_count ?? 0);
  const rateLimit = Number(policy.rate_limit_per_minute ?? 60);
  if (currentMinuteCount + activeRetryItems.length > rateLimit) {
    throw new DatabaseError(`Workspace rate limit exceeded: cannot enqueue retry jobs`);
  }

  const spendLimit = BigInt(policy.monthly_budget_microunits ?? '0');
  const currentSpend = BigInt(policy.current_spend_microunits ?? '0');
  const currentReserved = BigInt(policy.reserved_spend_microunits ?? '0');
  const neededReservation = BigInt(reservationCost);

  if (currentSpend + currentReserved + neededReservation > spendLimit) {
    throw new DatabaseError(`Workspace monthly AI budget exceeded: cannot enqueue retry jobs`);
  }

  await client.query(
    `UPDATE workspace_ai_policies
     SET minute_request_count = minute_request_count + $1,
         reserved_spend_microunits = reserved_spend_microunits + $2,
         updated_at = NOW()
     WHERE workspace_id = $3`,
    [activeRetryItems.length, neededReservation.toString(), workspaceId],
  );

  // 4. Reset items & assignments, insert new operations, ai_runs, jobs, outbox
  const retriedItemIds: WorkItemId[] = [];
  for (const item of activeRetryItems) {
    const actualWorkItemId = failedTaskMap.get(item.taskKey)!;
    retriedItemIds.push(parseWorkItemId(actualWorkItemId));

    await client.query(
      `UPDATE work_items
       SET status = 'queued', failure_category = NULL, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [actualWorkItemId, workspaceId],
    );

    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'preparing', latest_report_code = NULL, updated_at = NOW(), version = version + 1
       WHERE work_item_id = $1 AND workspace_id = $2`,
      [actualWorkItemId, workspaceId],
    );

    await client.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, requested_by_user_id, work_order_id, work_item_id, created_at, updated_at
       ) VALUES ($1, $2, $3, 'product', $4, 'pending', $5, $6, $7, NOW(), NOW())`,
      [
        item.operationId,
        workspaceId,
        item.taskKey,
        woRow.product_id,
        actorUserId,
        workOrderId,
        actualWorkItemId,
      ],
    );

    await client.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, requested_by_user_id, purpose,
         provider, model, prompt_template, prompt_version, input_schema_version,
         output_schema_version, status, work_order_id, work_item_id, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'google', 'gemini-3.8-flash', $6, '1.0.0', 1, 1, 'queued', $7, $8, NOW(), NOW()
       )`,
      [
        item.aiRunId,
        workspaceId,
        item.operationId,
        actorUserId,
        item.taskKey,
        item.promptTemplate,
        workOrderId,
        actualWorkItemId,
      ],
    );

    const payload = {
      workspaceId,
      productId: woRow.product_id,
      workOrderId,
      workItemId: actualWorkItemId,
      taskKey: item.taskKey,
      roleKey: item.roleKey,
      operationId: item.operationId,
      aiRunId: item.aiRunId,
      reservedMicrounits: item.reservedMicrounits,
    };

    await client.query(
      `INSERT INTO job_executions (
         id, workspace_id, job_type, operation_id, ai_runId, status,
         attempt, max_attempts, reserved_spend_microunits, payload_json,
         work_order_id, work_item_id, created_at, updated_at
       ) VALUES (
         $1, $2, 'workforce_planning', $3, $4, 'queued', 0, 3, $5, $6, $7, $8, NOW(), NOW()
       )`,
      [
        item.jobId,
        workspaceId,
        item.operationId,
        item.aiRunId,
        item.reservedMicrounits,
        JSON.stringify(payload),
        workOrderId,
        actualWorkItemId,
      ],
    );

    await client.query(
      `INSERT INTO outbox_events (
         id, workspace_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, occurred_at, available_at, delivery_count, created_at
       ) VALUES (
         $1, $2, 'workforce.planning.retry_enqueued', 'work_item', $3,
         1, $4::jsonb, NOW(), NOW(), 0, NOW()
       )`,
      [
        item.outboxId,
        workspaceId,
        actualWorkItemId,
        JSON.stringify({ jobId: item.jobId, taskKey: item.taskKey }),
      ],
    );
  }

  // 5. Update work order status if needed
  if (woRow.status === 'failed') {
    await client.query(
      `UPDATE work_orders
       SET status = 'in_progress', completed_at = NULL, failure_category = NULL, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [workOrderId, workspaceId],
    );
  }

  // 6. Insert audit event
  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_user_id, actor_type, action,
       resource_type, resource_id, changes_json, result, created_at
     ) VALUES ($1, $2, $3, 'user', $4, $5, $6, $7, 'success', NOW())`,
    [
      params.auditEvent.id,
      workspaceId,
      actorUserId,
      params.auditEvent.action,
      params.auditEvent.resourceType,
      params.auditEvent.resourceId,
      JSON.stringify(params.auditEvent.changesJson),
    ],
  );

  const updatedWoRes = await client.query(
    `SELECT * FROM work_orders WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, workOrderId],
  );

  return {
    workOrder: mapWorkOrderRowToSummaryDTO(updatedWoRes.rows[0]),
    retriedItemIds,
    cached: false,
  };
}
