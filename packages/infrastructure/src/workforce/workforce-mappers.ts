import type {
  AgentAssignmentSummaryDTO,
  ContextPackageSummaryDTO,
  WorkItemDependencySummaryDTO,
  WorkItemSummaryDTO,
  WorkOrderSummaryDTO,
} from '@affiliate-content-os/application';
import {
  AGENT_ROLE_KEYS,
  ASSIGNMENT_OFFICE_STATES,
  isAssignmentOfficeState,
  isWorkItemExpectedArtifactType,
  isWorkItemStatus,
  isWorkItemTaskKey,
  isWorkOrderMissionType,
  isWorkOrderStatus,
  parseAgentAssignmentId,
  parseAgentRoleDefinitionId,
  parseAnalysisId,
  parseContextPackageId,
  parseProductId,
  parseUserId,
  parseWorkItemDependencyId,
  parseWorkItemId,
  parseWorkOrderId,
  parseWorkspaceId,
  WORK_ITEM_EXPECTED_ARTIFACT_TYPES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TASK_KEYS,
  WORK_ORDER_MISSION_TYPES,
  WORK_ORDER_STATUSES,
  type AgentRoleKey,
  type AnalysisId,
  type AssignmentOfficeState,
  type IsoTimestamp,
  type WorkItemExpectedArtifactType,
  type WorkItemId,
  type WorkItemSnapshot,
  type WorkItemStatus,
  type WorkItemTaskKey,
  type WorkOrderMissionType,
  type WorkOrderStatus,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import {
  isProxySafe,
  mapSafeTimestamp,
  validateAndCopy32ByteHash,
  validateBoundedString,
  validateEnum,
  validateOptionalBoundedString,
  validateSafeVersion,
  validateUuid,
} from '../catalog/mapper-helpers.js';

function extractRowObject(row: unknown, context: string): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || isProxySafe(row)) {
    throw new DatabaseError(`Corrupt database row: invalid row structure for ${context}`);
  }
  const proto = Object.getPrototypeOf(row);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError(`Corrupt database row: invalid row prototype for ${context}`);
  }
  return row as Record<string, unknown>;
}

function validatePriority(val: unknown, fieldName: string): number {
  const pri = typeof val === 'string' && /^\d+$/.test(val) ? Number(val) : val;
  if (typeof pri !== 'number' || !Number.isSafeInteger(pri) || pri < 1 || pri > 100) {
    throw new DatabaseError(`Corrupt database row: invalid priority for ${fieldName}`);
  }
  return pri;
}

export function mapWorkOrderRowToSummaryDTO(row: unknown): WorkOrderSummaryDTO {
  const v = extractRowObject(row, 'work_orders');

  const id = parseWorkOrderId(validateUuid(v['id'], 'work_orders.id'));
  const workspaceId = parseWorkspaceId(validateUuid(v['workspace_id'], 'work_orders.workspace_id'));
  const productId = parseProductId(validateUuid(v['product_id'], 'work_orders.product_id'));
  const contextPackageId = parseContextPackageId(
    validateUuid(v['context_package_id'], 'work_orders.context_package_id'),
  );

  const missionType = validateEnum<WorkOrderMissionType>(
    v['mission_type'],
    'work_orders.mission_type',
    WORK_ORDER_MISSION_TYPES,
  );
  if (!isWorkOrderMissionType(missionType)) {
    throw new DatabaseError(
      'Corrupt database row: invalid enum value for work_orders.mission_type',
    );
  }

  const graphTemplate = validateBoundedString(
    v['graph_template'],
    'work_orders.graph_template',
    1,
    64,
  );
  const graphVersion = validateSafeVersion(v['graph_version'], 'work_orders.graph_version');

  const status = validateEnum<WorkOrderStatus>(
    v['status'],
    'work_orders.status',
    WORK_ORDER_STATUSES,
  );
  if (!isWorkOrderStatus(status)) {
    throw new DatabaseError('Corrupt database row: invalid enum value for work_orders.status');
  }

  const priority = validatePriority(v['priority'], 'work_orders.priority');
  const createdByUserId = parseUserId(
    validateUuid(v['created_by_user_id'], 'work_orders.created_by_user_id'),
  );
  const failureCategory = validateOptionalBoundedString(
    v['failure_category'],
    'work_orders.failure_category',
    64,
  );

  const createdAt = mapSafeTimestamp(v['created_at'], 'work_orders.created_at');
  const updatedAt = mapSafeTimestamp(v['updated_at'], 'work_orders.updated_at');
  if (new Date(updatedAt).getTime() < new Date(createdAt).getTime()) {
    throw new DatabaseError('Corrupt database row: updated_at precedes created_at');
  }

  let completedAt: IsoTimestamp | null = null;
  if (v['completed_at'] !== null && v['completed_at'] !== undefined) {
    completedAt = mapSafeTimestamp(v['completed_at'], 'work_orders.completed_at');
    if (new Date(completedAt).getTime() < new Date(createdAt).getTime()) {
      throw new DatabaseError('Corrupt database row: completed_at precedes created_at');
    }
  }

  const isTerminal = status === 'completed' || status === 'failed' || status === 'canceled';
  if (isTerminal && completedAt === null) {
    throw new DatabaseError('Corrupt database row: terminal work_order requires completed_at');
  }
  if (!isTerminal && completedAt !== null) {
    throw new DatabaseError(
      'Corrupt database row: non-terminal work_order cannot have completed_at',
    );
  }

  const version = validateSafeVersion(v['version'], 'work_orders.version');

  return Object.freeze({
    id,
    workspaceId,
    productId,
    contextPackageId,
    missionType,
    graphTemplate,
    graphVersion,
    status,
    priority,
    createdByUserId,
    failureCategory,
    completedAt,
    createdAt,
    updatedAt,
    version,
  });
}

export function mapWorkItemRowToSummaryDTO(row: unknown): WorkItemSummaryDTO {
  const v = extractRowObject(row, 'work_items');

  const id = parseWorkItemId(validateUuid(v['id'], 'work_items.id'));
  const workOrderId = parseWorkOrderId(
    validateUuid(v['work_order_id'], 'work_items.work_order_id'),
  );
  const roleDefinitionId = parseAgentRoleDefinitionId(
    validateUuid(v['role_definition_id'], 'work_items.role_definition_id'),
  );

  const roleKey = validateEnum<AgentRoleKey>(v['role_key'], 'work_items.role_key', AGENT_ROLE_KEYS);

  const taskKey = validateEnum<WorkItemTaskKey>(
    v['task_key'],
    'work_items.task_key',
    WORK_ITEM_TASK_KEYS,
  );
  if (!isWorkItemTaskKey(taskKey)) {
    throw new DatabaseError('Corrupt database row: invalid enum value for work_items.task_key');
  }

  const expectedArtifactType = validateEnum<WorkItemExpectedArtifactType>(
    v['expected_artifact_type'],
    'work_items.expected_artifact_type',
    WORK_ITEM_EXPECTED_ARTIFACT_TYPES,
  );
  if (!isWorkItemExpectedArtifactType(expectedArtifactType)) {
    throw new DatabaseError(
      'Corrupt database row: invalid enum value for work_items.expected_artifact_type',
    );
  }

  const status = validateEnum<WorkItemStatus>(v['status'], 'work_items.status', WORK_ITEM_STATUSES);
  if (!isWorkItemStatus(status)) {
    throw new DatabaseError('Corrupt database row: invalid enum value for work_items.status');
  }

  const blockedReasonCode = validateOptionalBoundedString(
    v['blocked_reason_code'],
    'work_items.blocked_reason_code',
    64,
  );
  if (status === 'blocked' && blockedReasonCode === null) {
    throw new DatabaseError(
      'Corrupt database row: blocked work_item requires non-null blocked_reason_code',
    );
  }
  if (status !== 'blocked' && blockedReasonCode !== null) {
    throw new DatabaseError(
      'Corrupt database row: non-blocked work_item cannot have blocked_reason_code',
    );
  }

  const createdAt = mapSafeTimestamp(v['created_at'], 'work_items.created_at');
  const updatedAt = mapSafeTimestamp(v['updated_at'], 'work_items.updated_at');
  if (new Date(updatedAt).getTime() < new Date(createdAt).getTime()) {
    throw new DatabaseError('Corrupt database row: updated_at precedes created_at');
  }

  let startedAt: IsoTimestamp | null = null;
  if (v['started_at'] !== null && v['started_at'] !== undefined) {
    startedAt = mapSafeTimestamp(v['started_at'], 'work_items.started_at');
    if (new Date(startedAt).getTime() < new Date(createdAt).getTime()) {
      throw new DatabaseError('Corrupt database row: started_at precedes created_at');
    }
  }

  let completedAt: IsoTimestamp | null = null;
  if (v['completed_at'] !== null && v['completed_at'] !== undefined) {
    completedAt = mapSafeTimestamp(v['completed_at'], 'work_items.completed_at');
    if (new Date(completedAt).getTime() < new Date(createdAt).getTime()) {
      throw new DatabaseError('Corrupt database row: completed_at precedes created_at');
    }
    if (startedAt !== null && new Date(completedAt).getTime() < new Date(startedAt).getTime()) {
      throw new DatabaseError('Corrupt database row: completed_at precedes started_at');
    }
  }

  const isTerminal = status === 'completed' || status === 'failed' || status === 'canceled';
  if (isTerminal && completedAt === null) {
    throw new DatabaseError('Corrupt database row: terminal work_item requires completed_at');
  }
  if (!isTerminal && completedAt !== null) {
    throw new DatabaseError(
      'Corrupt database row: non-terminal work_item cannot have completed_at',
    );
  }

  const version = validateSafeVersion(v['version'], 'work_items.version');

  return Object.freeze({
    id,
    workOrderId,
    roleDefinitionId,
    roleKey,
    taskKey,
    expectedArtifactType,
    status,
    blockedReasonCode,
    startedAt,
    completedAt,
    createdAt,
    updatedAt,
    version,
  });
}

export function mapWorkItemRowToSnapshot(row: unknown): WorkItemSnapshot {
  const v = extractRowObject(row, 'work_items');

  const id = parseWorkItemId(validateUuid(v['id'], 'work_items.id'));
  const workspaceId = parseWorkspaceId(validateUuid(v['workspace_id'], 'work_items.workspace_id'));
  const workOrderId = parseWorkOrderId(
    validateUuid(v['work_order_id'], 'work_items.work_order_id'),
  );
  const roleDefinitionId = parseAgentRoleDefinitionId(
    validateUuid(v['role_definition_id'], 'work_items.role_definition_id'),
  );

  const taskKey = validateEnum<WorkItemTaskKey>(
    v['task_key'],
    'work_items.task_key',
    WORK_ITEM_TASK_KEYS,
  );
  if (!isWorkItemTaskKey(taskKey)) {
    throw new DatabaseError('Corrupt database row: invalid enum value for work_items.task_key');
  }

  const expectedArtifactType = validateEnum<WorkItemExpectedArtifactType>(
    v['expected_artifact_type'],
    'work_items.expected_artifact_type',
    WORK_ITEM_EXPECTED_ARTIFACT_TYPES,
  );
  if (!isWorkItemExpectedArtifactType(expectedArtifactType)) {
    throw new DatabaseError(
      'Corrupt database row: invalid enum value for work_items.expected_artifact_type',
    );
  }

  const status = validateEnum<WorkItemStatus>(v['status'], 'work_items.status', WORK_ITEM_STATUSES);
  if (!isWorkItemStatus(status)) {
    throw new DatabaseError('Corrupt database row: invalid enum value for work_items.status');
  }

  const blockedReasonCode = validateOptionalBoundedString(
    v['blocked_reason_code'],
    'work_items.blocked_reason_code',
    64,
  );
  if (status === 'blocked' && blockedReasonCode === null) {
    throw new DatabaseError(
      'Corrupt database row: blocked work_item requires non-null blocked_reason_code',
    );
  }
  if (status !== 'blocked' && blockedReasonCode !== null) {
    throw new DatabaseError(
      'Corrupt database row: non-blocked work_item cannot have blocked_reason_code',
    );
  }

  const createdAt = mapSafeTimestamp(v['created_at'], 'work_items.created_at');
  const updatedAt = mapSafeTimestamp(v['updated_at'], 'work_items.updated_at');
  if (new Date(updatedAt).getTime() < new Date(createdAt).getTime()) {
    throw new DatabaseError('Corrupt database row: updated_at precedes created_at');
  }

  let startedAt: IsoTimestamp | null = null;
  if (v['started_at'] !== null && v['started_at'] !== undefined) {
    startedAt = mapSafeTimestamp(v['started_at'], 'work_items.started_at');
    if (new Date(startedAt).getTime() < new Date(createdAt).getTime()) {
      throw new DatabaseError('Corrupt database row: started_at precedes created_at');
    }
  }

  let completedAt: IsoTimestamp | null = null;
  if (v['completed_at'] !== null && v['completed_at'] !== undefined) {
    completedAt = mapSafeTimestamp(v['completed_at'], 'work_items.completed_at');
    if (new Date(completedAt).getTime() < new Date(createdAt).getTime()) {
      throw new DatabaseError('Corrupt database row: completed_at precedes created_at');
    }
    if (startedAt !== null && new Date(completedAt).getTime() < new Date(startedAt).getTime()) {
      throw new DatabaseError('Corrupt database row: completed_at precedes started_at');
    }
  }

  const isTerminal = status === 'completed' || status === 'failed' || status === 'canceled';
  if (isTerminal && completedAt === null) {
    throw new DatabaseError('Corrupt database row: terminal work_item requires completed_at');
  }
  if (!isTerminal && completedAt !== null) {
    throw new DatabaseError(
      'Corrupt database row: non-terminal work_item cannot have completed_at',
    );
  }

  const version = validateSafeVersion(v['version'], 'work_items.version');

  return Object.freeze({
    id,
    workspaceId,
    workOrderId,
    roleDefinitionId,
    taskKey,
    expectedArtifactType,
    status,
    blockedReasonCode,
    startedAt,
    completedAt,
    createdAt,
    updatedAt,
    version,
  });
}

export function mapAgentAssignmentRowToSummaryDTO(row: unknown): AgentAssignmentSummaryDTO {
  const v = extractRowObject(row, 'agent_assignments');

  const id = parseAgentAssignmentId(validateUuid(v['id'], 'agent_assignments.id'));
  const workOrderId = parseWorkOrderId(
    validateUuid(v['work_order_id'], 'agent_assignments.work_order_id'),
  );
  const roleDefinitionId = parseAgentRoleDefinitionId(
    validateUuid(v['role_definition_id'], 'agent_assignments.role_definition_id'),
  );

  const roleKey = validateEnum<AgentRoleKey>(
    v['role_key'],
    'agent_assignments.role_key',
    AGENT_ROLE_KEYS,
  );

  let workItemId: WorkItemId | null = null;
  if (v['work_item_id'] !== null && v['work_item_id'] !== undefined) {
    workItemId = parseWorkItemId(validateUuid(v['work_item_id'], 'agent_assignments.work_item_id'));
  }

  if (roleKey === 'chief_of_staff' && workItemId !== null) {
    throw new DatabaseError(
      'Corrupt database row: chief_of_staff assignment cannot have work_item_id',
    );
  }
  if (roleKey !== 'chief_of_staff' && workItemId === null) {
    throw new DatabaseError(
      'Corrupt database row: non-chief_of_staff assignment must have work_item_id',
    );
  }

  const officeState = validateEnum<AssignmentOfficeState>(
    v['office_state'],
    'agent_assignments.office_state',
    ASSIGNMENT_OFFICE_STATES,
  );
  if (!isAssignmentOfficeState(officeState)) {
    throw new DatabaseError(
      'Corrupt database row: invalid enum value for agent_assignments.office_state',
    );
  }

  let waitingOnWorkItemId: WorkItemId | null = null;
  if (v['waiting_on_work_item_id'] !== null && v['waiting_on_work_item_id'] !== undefined) {
    waitingOnWorkItemId = parseWorkItemId(
      validateUuid(v['waiting_on_work_item_id'], 'agent_assignments.waiting_on_work_item_id'),
    );
  }

  if (officeState === 'waiting_dependency' && waitingOnWorkItemId === null) {
    throw new DatabaseError(
      'Corrupt database row: waiting_dependency assignment requires waiting_on_work_item_id',
    );
  }
  if (officeState !== 'waiting_dependency' && waitingOnWorkItemId !== null) {
    throw new DatabaseError(
      'Corrupt database row: non-waiting_dependency assignment cannot have waiting_on_work_item_id',
    );
  }

  const latestReportCode = validateOptionalBoundedString(
    v['latest_report_code'],
    'agent_assignments.latest_report_code',
    64,
  );

  const createdAt = mapSafeTimestamp(v['created_at'], 'agent_assignments.created_at');
  const updatedAt = mapSafeTimestamp(v['updated_at'], 'agent_assignments.updated_at');
  if (new Date(updatedAt).getTime() < new Date(createdAt).getTime()) {
    throw new DatabaseError('Corrupt database row: updated_at precedes created_at');
  }

  const version = validateSafeVersion(v['version'], 'agent_assignments.version');

  return Object.freeze({
    id,
    workOrderId,
    roleDefinitionId,
    roleKey,
    workItemId,
    officeState,
    waitingOnWorkItemId,
    latestReportCode,
    createdAt,
    updatedAt,
    version,
  });
}

export function mapWorkItemDependencyRowToSummaryDTO(row: unknown): WorkItemDependencySummaryDTO {
  const v = extractRowObject(row, 'work_item_dependencies');

  const id = parseWorkItemDependencyId(validateUuid(v['id'], 'work_item_dependencies.id'));
  const workOrderId = parseWorkOrderId(
    validateUuid(v['work_order_id'], 'work_item_dependencies.work_order_id'),
  );
  const workItemId = parseWorkItemId(
    validateUuid(v['work_item_id'], 'work_item_dependencies.work_item_id'),
  );
  const dependsOnWorkItemId = parseWorkItemId(
    validateUuid(v['depends_on_work_item_id'], 'work_item_dependencies.depends_on_work_item_id'),
  );

  if (workItemId === dependsOnWorkItemId) {
    throw new DatabaseError('Corrupt database row: self dependency in work_item_dependencies');
  }

  const createdAt = mapSafeTimestamp(v['created_at'], 'work_item_dependencies.created_at');

  return Object.freeze({
    id,
    workOrderId,
    workItemId,
    dependsOnWorkItemId,
    createdAt,
  });
}

export function mapContextPackageRowToSummaryDTO(
  row: unknown,
  analysisIds: readonly AnalysisId[],
): ContextPackageSummaryDTO {
  const v = extractRowObject(row, 'context_packages');

  const id = parseContextPackageId(validateUuid(v['id'], 'context_packages.id'));
  const workspaceId = parseWorkspaceId(
    validateUuid(v['workspace_id'], 'context_packages.workspace_id'),
  );
  const productId = parseProductId(validateUuid(v['product_id'], 'context_packages.product_id'));
  const factSetId = validateUuid(v['fact_set_id'], 'context_packages.fact_set_id');
  const contextSchemaVersion = validateSafeVersion(
    v['context_schema_version'],
    'context_packages.context_schema_version',
  );

  const hashBytes = validateAndCopy32ByteHash(v['context_hash'], 'context_packages.context_hash');
  const contextHashHex = Buffer.from(hashBytes).toString('hex');

  const createdByUserId = parseUserId(
    validateUuid(v['created_by_user_id'], 'context_packages.created_by_user_id'),
  );
  const createdAt = mapSafeTimestamp(v['created_at'], 'context_packages.created_at');

  const defensiveAnalysisIds = Object.freeze(
    [...analysisIds].map((idVal) => parseAnalysisId(idVal)),
  );

  return Object.freeze({
    id,
    workspaceId,
    productId,
    factSetId,
    contextSchemaVersion,
    contextHashHex,
    analysisIds: defensiveAnalysisIds,
    createdByUserId,
    createdAt,
  });
}
