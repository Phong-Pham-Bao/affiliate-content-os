import { isPlainObject, ApiError } from './api-validators-common.js';
import type {
  AgentAssignmentSummaryDTO,
  AgentRoleKey,
  AssignmentOfficeState,
  ContextPackageSummaryDTO,
  KickoffWorkOrderResult,
  RetryWorkOrderResult,
  WorkItemDependencySummaryDTO,
  WorkItemStatus,
  WorkItemSummaryDTO,
  WorkOrderDetailDTO,
  WorkOrderMissionType,
  WorkOrderStatus,
  WorkOrderSummaryDTO,
} from '../types/workforce.js';

function invalid(msg: string): never {
  throw new ApiError(500, {
    status: 500,
    title: 'Validation Error',
    detail: msg,
  });
}

export function validateWorkOrderSummary(val: unknown): WorkOrderSummaryDTO {
  if (!isPlainObject(val)) invalid('Work order summary must be an object');
  if (typeof val.id !== 'string') invalid('Work order id must be string');
  if (typeof val.workspaceId !== 'string') invalid('Work order workspaceId must be string');
  if (typeof val.productId !== 'string') invalid('Work order productId must be string');
  if (typeof val.status !== 'string') invalid('Work order status must be string');

  return {
    id: val.id,
    workspaceId: val.workspaceId,
    productId: val.productId,
    contextPackageId: String(val.contextPackageId ?? ''),
    missionType: (val.missionType as WorkOrderMissionType) ?? 'single_product_affiliate_launch',
    graphTemplate: String(val.graphTemplate ?? ''),
    graphVersion: Number(val.graphVersion ?? 1),
    status: val.status as WorkOrderStatus,
    priority: Number(val.priority ?? 0),
    createdByUserId: String(val.createdByUserId ?? ''),
    failureCategory: val.failureCategory ? String(val.failureCategory) : null,
    completedAt: val.completedAt ? String(val.completedAt) : null,
    createdAt: String(val.createdAt ?? ''),
    updatedAt: String(val.updatedAt ?? ''),
    version: Number(val.version ?? 1),
  };
}

export function validateWorkItemSummary(val: unknown): WorkItemSummaryDTO {
  if (!isPlainObject(val)) invalid('Work item summary must be an object');
  return {
    id: String(val.id),
    workOrderId: String(val.workOrderId),
    roleDefinitionId: String(val.roleDefinitionId),
    roleKey: val.roleKey as AgentRoleKey,
    taskKey: String(val.taskKey),
    expectedArtifactType: String(val.expectedArtifactType),
    status: val.status as WorkItemStatus,
    blockedReasonCode: val.blockedReasonCode ? String(val.blockedReasonCode) : null,
    startedAt: val.startedAt ? String(val.startedAt) : null,
    completedAt: val.completedAt ? String(val.completedAt) : null,
    createdAt: String(val.createdAt ?? ''),
    updatedAt: String(val.updatedAt ?? ''),
    version: Number(val.version ?? 1),
  };
}

export function validateAgentAssignmentSummary(val: unknown): AgentAssignmentSummaryDTO {
  if (!isPlainObject(val)) invalid('Agent assignment must be an object');
  return {
    id: String(val.id),
    workOrderId: String(val.workOrderId),
    roleDefinitionId: String(val.roleDefinitionId),
    roleKey: val.roleKey as AgentRoleKey,
    workItemId: val.workItemId ? String(val.workItemId) : null,
    officeState: (val.officeState as AssignmentOfficeState) ?? 'idle',
    waitingOnWorkItemId: val.waitingOnWorkItemId ? String(val.waitingOnWorkItemId) : null,
    latestReportCode: val.latestReportCode ? String(val.latestReportCode) : null,
    createdAt: String(val.createdAt ?? ''),
    updatedAt: String(val.updatedAt ?? ''),
    version: Number(val.version ?? 1),
  };
}

export function validateWorkOrderDetail(val: unknown): WorkOrderDetailDTO {
  if (!isPlainObject(val)) invalid('Work order detail must be an object');
  const workOrder = validateWorkOrderSummary(val.workOrder);
  const cp = isPlainObject(val.contextPackage)
    ? val.contextPackage
    : invalid('contextPackage missing');
  const contextPackage: ContextPackageSummaryDTO = {
    id: String(cp.id),
    workspaceId: String(cp.workspaceId),
    productId: String(cp.productId),
    factSetId: String(cp.factSetId),
    contextSchemaVersion: Number(cp.contextSchemaVersion ?? 1),
    contextHashHex: String(cp.contextHashHex ?? ''),
    analysisIds: Array.isArray(cp.analysisIds) ? cp.analysisIds.map(String) : [],
    createdByUserId: String(cp.createdByUserId ?? ''),
    createdAt: String(cp.createdAt ?? ''),
  };
  const workItems: WorkItemSummaryDTO[] = Array.isArray(val.workItems)
    ? val.workItems.map(validateWorkItemSummary)
    : [];
  const assignments: AgentAssignmentSummaryDTO[] = Array.isArray(val.assignments)
    ? val.assignments.map(validateAgentAssignmentSummary)
    : [];
  const dependencies: WorkItemDependencySummaryDTO[] = Array.isArray(val.dependencies)
    ? val.dependencies.map((d: unknown) => {
        const obj = isPlainObject(d) ? d : {};
        return {
          id: String(obj.id ?? ''),
          workOrderId: String(obj.workOrderId ?? ''),
          workItemId: String(obj.workItemId ?? ''),
          dependsOnWorkItemId: String(obj.dependsOnWorkItemId ?? ''),
          createdAt: String(obj.createdAt ?? ''),
        };
      })
    : [];

  return { workOrder, contextPackage, workItems, assignments, dependencies };
}

export function validateWorkOrderList(val: unknown): {
  items: readonly WorkOrderSummaryDTO[];
  nextCursor: string | null;
} {
  if (!isPlainObject(val)) invalid('Work order list response must be an object');
  const rawItems = Array.isArray(val.items) ? val.items : [];
  return {
    items: rawItems.map(validateWorkOrderSummary),
    nextCursor: val.nextCursor ? String(val.nextCursor) : null,
  };
}

export function validateKickoffResult(val: unknown): KickoffWorkOrderResult {
  if (!isPlainObject(val)) invalid('Kickoff result must be an object');
  return {
    workOrder: validateWorkOrderSummary(val.workOrder),
    cached: Boolean(val.cached),
  };
}

export function validateRetryResult(val: unknown): RetryWorkOrderResult {
  if (!isPlainObject(val)) invalid('Retry result must be an object');
  return {
    workOrder: validateWorkOrderSummary(val.workOrder),
    retriedItemIds: Array.isArray(val.retriedItemIds) ? val.retriedItemIds.map(String) : [],
    cached: Boolean(val.cached),
  };
}
