import type pg from 'pg';
import type { WorkOrderSummaryDTO } from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import { mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';
import { insertKickoffPlanningJobs } from './kickoff-planning-job-inserts.js';
import type { KickoffPersistenceSnapshot, KickoffTestHooks } from './workforce-types.js';

export async function insertKickoffEntities(
  client: pg.PoolClient,
  snapshot: KickoffPersistenceSnapshot,
  testHooks?: KickoffTestHooks,
): Promise<WorkOrderSummaryDTO> {
  // 1. Insert context_packages
  await client.query(
    `INSERT INTO context_packages (
       id, workspace_id, product_id, fact_set_id,
       context_schema_version, context_hash, created_by_user_id, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      snapshot.contextPackage.id,
      snapshot.contextPackage.workspaceId,
      snapshot.contextPackage.productId,
      snapshot.contextPackage.factSetId,
      snapshot.contextPackage.contextSchemaVersion,
      snapshot.contextPackage.contextHashBuf,
      snapshot.contextPackage.createdByUserId,
    ],
  );
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('context_packages');
  }

  // 2. Insert context_package_analyses from verified sourceAnalyses
  for (const analysis of snapshot.contextPackage.sourceAnalyses) {
    await client.query(
      `INSERT INTO context_package_analyses (
         workspace_id, context_package_id, analysis_id, created_at
       ) VALUES ($1, $2, $3, NOW())`,
      [snapshot.workOrder.workspaceId, snapshot.contextPackage.id, analysis.id],
    );
  }
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('context_package_analyses');
  }

  // 3. Insert work_orders
  const orderRes = await client.query(
    `INSERT INTO work_orders (
       id, workspace_id, product_id, context_package_id,
       mission_type, directive_text, graph_template, graph_version,
       status, priority, created_by_user_id, failure_category,
       completed_at, created_at, updated_at, version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, NULL, NOW(), NOW(), 1)
     RETURNING *`,
    [
      snapshot.workOrder.id,
      snapshot.workOrder.workspaceId,
      snapshot.workOrder.productId,
      snapshot.workOrder.contextPackageId,
      snapshot.workOrder.missionType,
      snapshot.workOrder.directiveText,
      snapshot.workOrder.graphTemplate,
      snapshot.workOrder.graphVersion,
      snapshot.workOrder.status,
      snapshot.workOrder.priority,
      snapshot.workOrder.createdByUserId,
    ],
  );

  if (orderRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert work order ${snapshot.workOrder.id}`);
  }
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('work_orders');
  }

  // 4. Insert work_items
  for (const item of snapshot.workItems) {
    await client.query(
      `INSERT INTO work_items (
         id, workspace_id, work_order_id, role_definition_id,
         task_key, expected_artifact_type, status, blocked_reason_code,
         started_at, completed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, NOW(), NOW(), 1)`,
      [
        item.id,
        item.workspaceId,
        item.workOrderId,
        item.roleDefinitionId,
        item.taskKey,
        item.expectedArtifactType,
        item.status,
      ],
    );
  }
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('work_items');
  }

  // 5. Insert work_item_dependencies
  for (const dep of snapshot.dependencies) {
    await client.query(
      `INSERT INTO work_item_dependencies (
         id, workspace_id, work_order_id, work_item_id,
         depends_on_work_item_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [dep.id, dep.workspaceId, dep.workOrderId, dep.workItemId, dep.dependsOnWorkItemId],
    );
  }
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('work_item_dependencies');
  }

  // 6. Insert agent_assignments
  for (const assignment of snapshot.assignments) {
    await client.query(
      `INSERT INTO agent_assignments (
         id, workspace_id, work_order_id, role_definition_id,
         work_item_id, office_state, waiting_on_work_item_id, latest_report_code,
         created_at, updated_at, version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NOW(), NOW(), 1)`,
      [
        assignment.id,
        assignment.workspaceId,
        assignment.workOrderId,
        assignment.roleDefinitionId,
        assignment.workItemId,
        assignment.officeState,
        assignment.waitingOnWorkItemId,
      ],
    );
  }
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('agent_assignments');
  }

  // 7. Insert planning jobs (operations, ai_runs, job_executions, outbox_events)
  await insertKickoffPlanningJobs(client, snapshot, testHooks);

  const createdOrder = mapWorkOrderRowToSummaryDTO(orderRes.rows[0]);

  // 8. Insert idempotency_keys
  await client.query(
    `INSERT INTO idempotency_keys (
       id, workspace_id, principal_id, route_key, key_hash, request_hash,
       status_code, response_json, resource_type, resource_id, expires_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'work_order', $9, NOW() + INTERVAL '24 hours', NOW())`,
    [
      snapshot.idempotency.id,
      snapshot.workOrder.workspaceId,
      snapshot.idempotency.principalId,
      snapshot.idempotency.routeKey,
      snapshot.idempotency.keyHashBuf,
      snapshot.idempotency.requestHashBuf,
      snapshot.idempotency.statusCode,
      JSON.stringify(createdOrder),
      snapshot.workOrder.id,
    ],
  );
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('idempotency_keys');
  }

  // 8. Insert audit_events
  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, reason_code, changes_json, occurred_at, created_at
     ) VALUES ($1, $2, 'user', $3, $4, $5, $6, 'succeeded', NULL, $7, NOW(), NOW())`,
    [
      snapshot.auditEvent.id,
      snapshot.auditEvent.workspaceId,
      snapshot.auditEvent.actorUserId,
      snapshot.auditEvent.action,
      snapshot.auditEvent.resourceType,
      snapshot.auditEvent.resourceId,
      JSON.stringify(snapshot.auditEvent.changesJson),
    ],
  );
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('audit_events');
  }

  return createdOrder;
}
