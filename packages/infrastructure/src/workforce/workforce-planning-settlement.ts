import type pg from 'pg';
import { JobLeaseExpiredError } from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import type { WorkforcePlanningSettlementParams } from './workforce-planning-settlement-types.js';
import {
  handleSuccessSettlement,
  handleTerminalFailure,
  handleTransientFailure,
  handleRepairSettlement,
} from './workforce-planning-settlement-handlers.js';

export async function settleWorkforcePlanningJobAtomic(
  client: pg.PoolClient,
  params: WorkforcePlanningSettlementParams,
): Promise<{ artifactId?: string }> {
  // 1. Lease fencing check with explicit database time comparison
  const jobRes = await client.query(
    `SELECT id, workspace_id, status, attempt, max_attempts, version, lease_owner,
            lease_expires_at, reserved_spend_microunits,
            operation_id, ai_run_id, work_order_id, work_item_id,
            (NOW() >= lease_expires_at) AS is_lease_expired
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
    job.is_lease_expired ||
    !job.lease_expires_at ||
    Number(job.version) !== params.jobVersion ||
    job.lease_owner !== params.workerId ||
    job.status !== 'running'
  ) {
    throw new JobLeaseExpiredError(params.jobId);
  }

  // 2. Structural linkage verification across entire entity graph
  if (
    job.operation_id !== params.operationId ||
    job.ai_run_id !== params.aiRunId ||
    job.work_order_id !== params.workOrderId ||
    job.work_item_id !== params.workItemId
  ) {
    throw new DatabaseError(`Structural linkage mismatch on job execution ${params.jobId}`);
  }

  const opRes = await client.query(
    `SELECT id, status, resource_id, operation_type, work_order_id, work_item_id
     FROM operations
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [params.operationId, params.workspaceId],
  );
  if (opRes.rowCount === 0 || !opRes.rows[0]) {
    throw new DatabaseError(`Operation not found: ${params.operationId}`);
  }
  const op = opRes.rows[0];
  if (
    op.work_order_id !== params.workOrderId ||
    op.work_item_id !== params.workItemId ||
    op.resource_id !== params.productId
  ) {
    throw new DatabaseError(`Structural linkage mismatch on operation ${params.operationId}`);
  }
  if (params.taskKey && op.operation_type !== params.taskKey) {
    throw new DatabaseError(`Operation type mismatch on operation ${params.operationId}`);
  }
  if (op.status === 'succeeded' || op.status === 'failed' || op.status === 'canceled') {
    throw new DatabaseError(`Operation ${params.operationId} is already terminal (${op.status})`);
  }

  const runRes = await client.query(
    `SELECT id, status, operation_id, purpose, work_order_id, work_item_id
     FROM ai_runs
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [params.aiRunId, params.workspaceId],
  );
  if (runRes.rowCount === 0 || !runRes.rows[0]) {
    throw new DatabaseError(`AI run not found: ${params.aiRunId}`);
  }
  const run = runRes.rows[0];
  if (
    run.operation_id !== params.operationId ||
    run.work_order_id !== params.workOrderId ||
    run.work_item_id !== params.workItemId
  ) {
    throw new DatabaseError(`Structural linkage mismatch on AI run ${params.aiRunId}`);
  }
  if (params.taskKey && run.purpose !== params.taskKey) {
    throw new DatabaseError(`AI run purpose mismatch on ${params.aiRunId}`);
  }
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
    throw new DatabaseError(`AI run ${params.aiRunId} is already terminal (${run.status})`);
  }

  const woRes = await client.query(
    `SELECT id, product_id, status
     FROM work_orders
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [params.workOrderId, params.workspaceId],
  );
  if (woRes.rowCount === 0 || !woRes.rows[0]) {
    throw new DatabaseError(`Work order not found: ${params.workOrderId}`);
  }
  const wo = woRes.rows[0];
  if (params.productId && wo.product_id !== params.productId) {
    throw new DatabaseError(`Product mismatch on work order ${params.workOrderId}`);
  }
  if (wo.status !== 'in_progress' && wo.status !== 'ready') {
    throw new DatabaseError(`Work order ${params.workOrderId} is not active (${wo.status})`);
  }

  const wiRes = await client.query(
    `SELECT id, task_key, expected_artifact_type, status
     FROM work_items
     WHERE id = $1 AND workspace_id = $2 AND work_order_id = $3
     FOR UPDATE`,
    [params.workItemId, params.workspaceId, params.workOrderId],
  );
  if (wiRes.rowCount === 0 || !wiRes.rows[0]) {
    throw new DatabaseError(`Work item not found: ${params.workItemId}`);
  }
  const wi = wiRes.rows[0];
  if (params.taskKey && wi.task_key !== params.taskKey) {
    throw new DatabaseError(`Task key mismatch on work item ${params.workItemId}`);
  }
  if (params.artifactType && wi.expected_artifact_type !== params.artifactType) {
    throw new DatabaseError(`Artifact type mismatch on work item ${params.workItemId}`);
  }
  if (wi.status !== 'queued' && wi.status !== 'running') {
    throw new DatabaseError(`Work item ${params.workItemId} is not active (${wi.status})`);
  }

  const asgRes = params.assignmentId
    ? await client.query(
        `SELECT a.id, rd.role_key, a.work_item_id
         FROM agent_assignments a
         JOIN agent_role_definitions rd ON rd.id = a.role_definition_id
         WHERE a.id = $1 AND a.workspace_id = $2 AND a.work_order_id = $3
         FOR UPDATE OF a`,
        [params.assignmentId, params.workspaceId, params.workOrderId],
      )
    : await client.query(
        `SELECT a.id, rd.role_key, a.work_item_id
         FROM agent_assignments a
         JOIN agent_role_definitions rd ON rd.id = a.role_definition_id
         WHERE a.work_item_id = $1 AND a.workspace_id = $2 AND a.work_order_id = $3
         FOR UPDATE OF a`,
        [params.workItemId, params.workspaceId, params.workOrderId],
      );
  if (asgRes.rowCount === 0 || !asgRes.rows[0]) {
    throw new DatabaseError(`Agent assignment not found for work item ${params.workItemId}`);
  }
  const asg = asgRes.rows[0];
  if (asg.work_item_id !== params.workItemId) {
    throw new DatabaseError(`Assignment work item mismatch: ${asg.id}`);
  }
  if (params.authorRoleKey && asg.role_key !== params.authorRoleKey) {
    throw new DatabaseError(`Assignment role key mismatch: ${asg.id}`);
  }

  const effectiveProductId = params.productId || wo.product_id;
  const prodRes = await client.query(
    `SELECT id FROM products WHERE id = $1 AND workspace_id = $2`,
    [effectiveProductId, params.workspaceId],
  );
  if (prodRes.rowCount === 0) {
    throw new DatabaseError(
      `Product ${effectiveProductId} not found in workspace ${params.workspaceId}`,
    );
  }

  const reserved = Number(job.reserved_spend_microunits ?? params.reservedMicrounits);

  if (params.outcome.kind === 'success') {
    return handleSuccessSettlement(client, params, reserved);
  } else if (params.outcome.kind === 'transient_failure') {
    await handleTransientFailure(client, params);
    return {};
  } else if (params.outcome.kind === 'repair') {
    await handleRepairSettlement(client, params);
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
  WorkforceRepairOutcome,
} from './workforce-planning-settlement-types.js';
