import type {
  AgentAssignmentSummaryDTO,
  ContextPackageSummaryDTO,
  WorkItemDependencySummaryDTO,
  WorkItemSummaryDTO,
  WorkOrderSummaryDTO,
} from '@affiliate-content-os/application';
import {
  dateToIsoTimestamp,
  isAssignmentOfficeState,
  isWorkItemExpectedArtifactType,
  isWorkItemStatus,
  isWorkItemTaskKey,
  isWorkOrderMissionType,
  isWorkOrderStatus,
  parseAgentAssignmentId,
  parseAgentRoleDefinitionId,
  parseAgentRoleKey,
  parseContextPackageId,
  parseProductId,
  parseUserId,
  parseWorkItemDependencyId,
  parseWorkItemId,
  parseWorkOrderId,
  parseWorkspaceId,
  type AnalysisId,
  type WorkItemSnapshot,
} from '@affiliate-content-os/domain';
import type {
  RawAgentAssignmentRow,
  RawContextPackageRow,
  RawWorkItemDependencyRow,
  RawWorkItemRow,
  RawWorkOrderRow,
} from './workforce-types.js';

export function mapWorkOrderRowToSummaryDTO(row: RawWorkOrderRow): WorkOrderSummaryDTO {
  const missionType = isWorkOrderMissionType(row.mission_type) ? row.mission_type : 'custom';
  const status = isWorkOrderStatus(row.status) ? row.status : 'preparing';

  return {
    id: parseWorkOrderId(row.id),
    workspaceId: parseWorkspaceId(row.workspace_id),
    productId: parseProductId(row.product_id),
    contextPackageId: parseContextPackageId(row.context_package_id),
    missionType,
    graphTemplate: row.graph_template,
    graphVersion: Number(row.graph_version),
    status,
    priority: Number(row.priority),
    createdByUserId: parseUserId(row.created_by_user_id),
    failureCategory: row.failure_category ?? null,
    completedAt: row.completed_at ? dateToIsoTimestamp(new Date(row.completed_at)) : null,
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
    updatedAt: dateToIsoTimestamp(new Date(row.updated_at)),
    version: Number(row.version),
  };
}

export function mapWorkItemRowToSummaryDTO(row: RawWorkItemRow): WorkItemSummaryDTO {
  const taskKey = isWorkItemTaskKey(row.task_key) ? row.task_key : 'product_strategy';
  const expectedArtifactType = isWorkItemExpectedArtifactType(row.expected_artifact_type)
    ? row.expected_artifact_type
    : 'product_campaign_plan';
  const status = isWorkItemStatus(row.status) ? row.status : 'ready';

  return {
    id: parseWorkItemId(row.id),
    workOrderId: parseWorkOrderId(row.work_order_id),
    roleDefinitionId: parseAgentRoleDefinitionId(row.role_definition_id),
    roleKey: parseAgentRoleKey(row.role_key ?? 'product_strategist'),
    taskKey,
    expectedArtifactType,
    status,
    blockedReasonCode: row.blocked_reason_code ?? null,
    startedAt: row.started_at ? dateToIsoTimestamp(new Date(row.started_at)) : null,
    completedAt: row.completed_at ? dateToIsoTimestamp(new Date(row.completed_at)) : null,
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
    updatedAt: dateToIsoTimestamp(new Date(row.updated_at)),
    version: Number(row.version),
  };
}

export function mapWorkItemRowToSnapshot(row: RawWorkItemRow): WorkItemSnapshot {
  const taskKey = isWorkItemTaskKey(row.task_key) ? row.task_key : 'product_strategy';
  const expectedArtifactType = isWorkItemExpectedArtifactType(row.expected_artifact_type)
    ? row.expected_artifact_type
    : 'product_campaign_plan';
  const status = isWorkItemStatus(row.status) ? row.status : 'ready';

  return {
    id: parseWorkItemId(row.id),
    workspaceId: parseWorkspaceId(row.workspace_id),
    workOrderId: parseWorkOrderId(row.work_order_id),
    roleDefinitionId: parseAgentRoleDefinitionId(row.role_definition_id),
    taskKey,
    expectedArtifactType,
    status,
    blockedReasonCode: row.blocked_reason_code ?? null,
    startedAt: row.started_at ? dateToIsoTimestamp(new Date(row.started_at)) : null,
    completedAt: row.completed_at ? dateToIsoTimestamp(new Date(row.completed_at)) : null,
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
    updatedAt: dateToIsoTimestamp(new Date(row.updated_at)),
    version: Number(row.version),
  };
}

export function mapAgentAssignmentRowToSummaryDTO(
  row: RawAgentAssignmentRow,
): AgentAssignmentSummaryDTO {
  const officeState = isAssignmentOfficeState(row.office_state) ? row.office_state : 'preparing';

  return {
    id: parseAgentAssignmentId(row.id),
    workOrderId: parseWorkOrderId(row.work_order_id),
    roleDefinitionId: parseAgentRoleDefinitionId(row.role_definition_id),
    roleKey: parseAgentRoleKey(row.role_key ?? 'chief_of_staff'),
    workItemId: row.work_item_id ? parseWorkItemId(row.work_item_id) : null,
    officeState,
    waitingOnWorkItemId: row.waiting_on_work_item_id
      ? parseWorkItemId(row.waiting_on_work_item_id)
      : null,
    latestReportCode: row.latest_report_code ?? null,
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
    updatedAt: dateToIsoTimestamp(new Date(row.updated_at)),
    version: Number(row.version),
  };
}

export function mapWorkItemDependencyRowToSummaryDTO(
  row: RawWorkItemDependencyRow,
): WorkItemDependencySummaryDTO {
  return {
    id: parseWorkItemDependencyId(row.id),
    workOrderId: parseWorkOrderId(row.work_order_id),
    workItemId: parseWorkItemId(row.work_item_id),
    dependsOnWorkItemId: parseWorkItemId(row.depends_on_work_item_id),
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
  };
}

export function mapContextPackageRowToSummaryDTO(
  row: RawContextPackageRow,
  analysisIds: readonly AnalysisId[],
): ContextPackageSummaryDTO {
  const hashBuf = Buffer.isBuffer(row.context_hash)
    ? row.context_hash
    : Buffer.from(row.context_hash);

  return {
    id: parseContextPackageId(row.id),
    workspaceId: parseWorkspaceId(row.workspace_id),
    productId: parseProductId(row.product_id),
    factSetId: row.fact_set_id,
    contextSchemaVersion: Number(row.context_schema_version),
    contextHashHex: hashBuf.toString('hex'),
    analysisIds,
    createdByUserId: parseUserId(row.created_by_user_id),
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
  };
}
