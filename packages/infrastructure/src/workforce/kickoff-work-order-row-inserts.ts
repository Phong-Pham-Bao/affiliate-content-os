import type pg from 'pg';
import type {
  KickoffWorkOrderAtomicParams,
  WorkOrderSummaryDTO,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import { mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';
import type { KickoffTestHooks } from './workforce-types.js';

export async function insertKickoffEntities(
  client: pg.PoolClient,
  params: KickoffWorkOrderAtomicParams,
  testHooks?: KickoffTestHooks,
): Promise<WorkOrderSummaryDTO> {
  const contextHashBuf = Buffer.from(new Uint8Array(params.contextPackage.contextHash));
  const keyHashBuf = Buffer.from(new Uint8Array(params.idempotency.keyHash));
  const requestHashBuf = Buffer.from(new Uint8Array(params.idempotency.requestHash));

  // 1. Insert context_packages
  await client.query(
    `INSERT INTO context_packages (
       id, workspace_id, product_id, fact_set_id,
       context_schema_version, context_hash, created_by_user_id, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      params.contextPackage.id,
      params.contextPackage.workspaceId,
      params.contextPackage.productId,
      params.contextPackage.factSetId,
      params.contextPackage.contextSchemaVersion,
      contextHashBuf,
      params.contextPackage.createdByUserId,
    ],
  );
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('context_packages');
  }

  // 2. Insert context_package_analyses
  for (const analysisId of params.sourceAnalysisIds) {
    await client.query(
      `INSERT INTO context_package_analyses (
         workspace_id, context_package_id, analysis_id, created_at
       ) VALUES ($1, $2, $3, NOW())`,
      [params.workOrder.workspaceId, params.contextPackage.id, analysisId],
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
      params.workOrder.id,
      params.workOrder.workspaceId,
      params.workOrder.productId,
      params.workOrder.contextPackageId,
      params.workOrder.missionType,
      params.workOrder.directiveText,
      params.workOrder.graphTemplate,
      params.workOrder.graphVersion,
      params.workOrder.status,
      params.workOrder.priority,
      params.workOrder.createdByUserId,
    ],
  );

  if (orderRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert work order ${params.workOrder.id}`);
  }
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('work_orders');
  }

  // 4. Insert work_items
  for (const item of params.workItems) {
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
  for (const dep of params.dependencies) {
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
  for (const assignment of params.assignments) {
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

  const createdOrder = mapWorkOrderRowToSummaryDTO(orderRes.rows[0]);

  // 7. Insert idempotency_keys
  await client.query(
    `INSERT INTO idempotency_keys (
       id, workspace_id, principal_id, route_key, key_hash, request_hash,
       status_code, response_json, resource_type, resource_id, expires_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'work_order', $9, NOW() + INTERVAL '24 hours', NOW())`,
    [
      params.idempotency.id,
      params.workOrder.workspaceId,
      params.idempotency.principalId,
      params.idempotency.routeKey,
      keyHashBuf,
      requestHashBuf,
      params.idempotency.statusCode,
      JSON.stringify(createdOrder),
      params.workOrder.id,
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
      params.auditEvent.id,
      params.auditEvent.workspaceId,
      params.auditEvent.actorUserId,
      params.auditEvent.action,
      params.auditEvent.resourceType,
      params.auditEvent.resourceId,
      JSON.stringify(params.auditEvent.changesJson),
    ],
  );
  if (testHooks?.onAfterStage) {
    await testHooks.onAfterStage('audit_events');
  }

  return createdOrder;
}
