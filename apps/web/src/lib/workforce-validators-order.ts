import { isPlainObject, ApiError } from './api-validators-common.js';
import {
  CANONICAL_MISSION_TYPES,
  CANONICAL_OFFICE_STATES,
  CANONICAL_ROLE_KEYS,
  CANONICAL_WORK_ITEM_STATUSES,
  CANONICAL_WORK_ORDER_STATUSES,
  type AgentAssignmentSummaryDTO,
  type AgentRoleKey,
  type AssignmentOfficeState,
  type ContextPackageSummaryDTO,
  type KickoffWorkOrderResult,
  type RetryWorkOrderResult,
  type WorkItemDependencySummaryDTO,
  type WorkItemStatus,
  type WorkItemSummaryDTO,
  type WorkOrderDetailDTO,
  type WorkOrderMissionType,
  type WorkOrderStatus,
  type WorkOrderSummaryDTO,
} from '../types/workforce.js';

function invalid(msg: string): never {
  throw new ApiError(500, {
    status: 500,
    title: 'Validation Error',
    detail: msg,
  });
}

export function validateWorkOrderStatus(raw: unknown): WorkOrderStatus {
  if (typeof raw !== 'string') invalid('Work order status must be string');
  if (raw === 'cancelled') return 'canceled';
  if (raw === 'pending') return 'preparing';
  if ((CANONICAL_WORK_ORDER_STATUSES as readonly string[]).includes(raw)) {
    return raw as WorkOrderStatus;
  }
  invalid(`Unknown work order status: ${raw}`);
}

export function validateWorkItemStatus(raw: unknown): WorkItemStatus {
  if (typeof raw !== 'string') invalid('Work item status must be string');
  if (raw === 'in_progress') return 'running';
  if (raw === 'cancelled') return 'canceled';
  if ((CANONICAL_WORK_ITEM_STATUSES as readonly string[]).includes(raw)) {
    return raw as WorkItemStatus;
  }
  invalid(`Unknown work item status: ${raw}`);
}

export function validateAgentRoleKey(raw: unknown): AgentRoleKey {
  if (typeof raw !== 'string') invalid('Agent role key must be string');
  if ((CANONICAL_ROLE_KEYS as readonly string[]).includes(raw)) {
    return raw as AgentRoleKey;
  }
  invalid(`Unknown agent role key: ${raw}`);
}

export function validateWorkOrderMissionType(raw: unknown): WorkOrderMissionType {
  if (raw === undefined || raw === null || raw === '') {
    return 'single_product_affiliate_launch';
  }
  if (typeof raw !== 'string') invalid('Work order mission type must be string');
  if ((CANONICAL_MISSION_TYPES as readonly string[]).includes(raw)) {
    return raw as WorkOrderMissionType;
  }
  invalid(`Unknown work order mission type: ${raw}`);
}

export function normalizeOfficeState(raw: unknown): AssignmentOfficeState {
  if (typeof raw !== 'string') return 'idle';
  if (raw === 'working') return 'running';
  if (raw === 'waiting') return 'waiting_dependency';
  if (raw === 'cancelled') return 'canceled';
  if ((CANONICAL_OFFICE_STATES as readonly string[]).includes(raw)) {
    return raw as AssignmentOfficeState;
  }
  invalid(`Unknown assignment office state: ${raw}`);
}

export function validateWorkOrderSummary(val: unknown): WorkOrderSummaryDTO {
  if (!isPlainObject(val)) invalid('Work order summary must be an object');
  if (typeof val.id !== 'string') invalid('Work order id must be string');
  if (typeof val.workspaceId !== 'string') invalid('Work order workspaceId must be string');
  if (typeof val.productId !== 'string') invalid('Work order productId must be string');

  return {
    id: val.id,
    workspaceId: val.workspaceId,
    productId: val.productId,
    contextPackageId: String(val.contextPackageId ?? ''),
    missionType: validateWorkOrderMissionType(val.missionType),
    graphTemplate: String(val.graphTemplate ?? ''),
    graphVersion: Number(val.graphVersion ?? 1),
    status: validateWorkOrderStatus(val.status),
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
    roleKey: validateAgentRoleKey(val.roleKey),
    taskKey: String(val.taskKey),
    expectedArtifactType: String(val.expectedArtifactType),
    status: validateWorkItemStatus(val.status),
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
    roleKey: validateAgentRoleKey(val.roleKey),
    workItemId: val.workItemId ? String(val.workItemId) : null,
    officeState: normalizeOfficeState(val.officeState),
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
