import {
  parseAIRunId,
  parseContextPackageId,
  parseOperationId,
  parseProductId,
  parseUserId,
  parseWorkItemId,
  parseWorkOrderId,
  parseWorkspaceId,
  type AIRunId,
  type ContextPackageId,
  type JobExecutionSnapshot,
  type OperationId,
  type ProductId,
  type UserId,
  type WorkItemId,
  type WorkOrderId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';

export type WorkforcePlanningTaskKey =
  'product_strategy' | 'audience_strategy' | 'creative_direction';

export type WorkforcePlanningRoleKey =
  'product_strategist' | 'audience_strategist' | 'creative_director';

export interface ValidatedWorkforcePlanningPayload {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly workOrderId: WorkOrderId;
  readonly workItemId: WorkItemId;
  readonly taskKey: WorkforcePlanningTaskKey;
  readonly roleKey: WorkforcePlanningRoleKey;
  readonly operationId: OperationId;
  readonly aiRunId: AIRunId;
  readonly contextPackageId: ContextPackageId;
  readonly actorUserId: UserId;
  readonly reservedMicrounits: number;
}

const ALLOWED_WORKFORCE_KEYS = new Set([
  'workspaceId',
  'productId',
  'workOrderId',
  'workItemId',
  'taskKey',
  'roleKey',
  'operationId',
  'aiRunId',
  'contextPackageId',
  'actorUserId',
  'reservedMicrounits',
]);

const ALLOWED_TASKS = new Set<string>([
  'product_strategy',
  'audience_strategy',
  'creative_direction',
]);

const ALLOWED_ROLES = new Set<string>([
  'product_strategist',
  'audience_strategist',
  'creative_director',
]);

const MAX_RESERVED_MICROUNITS = 100_000_000_000;

export function parseAndValidateWorkforcePlanningPayload(
  raw: unknown,
): ValidatedWorkforcePlanningPayload {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid workforce planning payload: must be a plain object');
  }

  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('Invalid workforce planning payload: must not have a custom prototype');
  }

  const ownKeys = Reflect.ownKeys(raw);
  for (const k of ownKeys) {
    if (typeof k !== 'string') {
      throw new Error('Invalid workforce planning payload: symbol properties are forbidden');
    }
    if (!ALLOWED_WORKFORCE_KEYS.has(k)) {
      throw new Error(`Invalid workforce planning payload: unknown property "${k}" is rejected`);
    }
    const desc = Object.getOwnPropertyDescriptor(raw, k);
    if (!desc || desc.get || desc.set) {
      throw new Error(
        `Invalid workforce planning payload: accessor descriptor on "${k}" forbidden`,
      );
    }
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.taskKey !== 'string' || !ALLOWED_TASKS.has(obj.taskKey)) {
    throw new Error(`Invalid workforce planning payload: unsupported taskKey`);
  }
  if (typeof obj.roleKey !== 'string' || !ALLOWED_ROLES.has(obj.roleKey)) {
    throw new Error(`Invalid workforce planning payload: unsupported roleKey`);
  }

  if (
    typeof obj.reservedMicrounits !== 'number' ||
    !Number.isSafeInteger(obj.reservedMicrounits) ||
    obj.reservedMicrounits < 0 ||
    obj.reservedMicrounits > MAX_RESERVED_MICROUNITS
  ) {
    throw new Error(
      'Invalid workforce planning payload: reservedMicrounits must be safe non-negative integer',
    );
  }

  return Object.freeze({
    workspaceId: parseWorkspaceId(obj.workspaceId),
    productId: parseProductId(obj.productId),
    workOrderId: parseWorkOrderId(obj.workOrderId),
    workItemId: parseWorkItemId(obj.workItemId),
    taskKey: obj.taskKey as WorkforcePlanningTaskKey,
    roleKey: obj.roleKey as WorkforcePlanningRoleKey,
    operationId: parseOperationId(obj.operationId),
    aiRunId: parseAIRunId(obj.aiRunId),
    contextPackageId: parseContextPackageId(obj.contextPackageId),
    actorUserId: parseUserId(obj.actorUserId),
    reservedMicrounits: obj.reservedMicrounits,
  });
}

export function crossCheckWorkforcePlanningPayload(
  payload: ValidatedWorkforcePlanningPayload,
  job: JobExecutionSnapshot,
): void {
  if (payload.workspaceId !== job.workspaceId) {
    throw new Error('Workforce job payload workspaceId does not match job column');
  }
  if (payload.operationId !== job.operationId) {
    throw new Error('Workforce job payload operationId does not match job column');
  }
  if (payload.aiRunId !== job.aiRunId) {
    throw new Error('Workforce job payload aiRunId does not match job column');
  }
  if (payload.reservedMicrounits !== job.reservedSpendMicrounits) {
    throw new Error('Workforce job payload reservedMicrounits does not match job column');
  }
}
