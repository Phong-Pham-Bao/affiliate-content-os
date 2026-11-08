import {
  parseAIRunId,
  parseOperationId,
  parseProductId,
  parseWorkItemId,
  parseWorkOrderId,
  parseWorkspaceId,
  type AIRunId,
  type JobExecutionSnapshot,
  type OperationId,
  type ProductId,
  type WorkItemId,
  type WorkOrderId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';

export interface ValidatedScriptwritingPayload {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly workOrderId: WorkOrderId;
  readonly workItemId: WorkItemId;
  readonly assignmentId: string;
  readonly videoNumber: 1 | 2 | 3 | 4 | 5;
  readonly targetVariantCount: number;
  readonly changeRequestId?: string | null | undefined;
  readonly changeInstruction?: string | null | undefined;
  readonly reservedMicrounits: number;
  readonly briefHash: string;
  readonly operationId: OperationId;
  readonly aiRunId: AIRunId;
}

const ALLOWED_SCRIPTWRITING_KEYS = new Set([
  'workspaceId',
  'productId',
  'workOrderId',
  'workItemId',
  'assignmentId',
  'videoNumber',
  'targetVariantCount',
  'changeRequestId',
  'changeInstruction',
  'reservedMicrounits',
  'briefHash',
  'operationId',
  'aiRunId',
]);

const MAX_RESERVED_MICROUNITS = 100_000_000_000;

export function parseAndValidateScriptwritingPayload(raw: unknown): ValidatedScriptwritingPayload {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid scriptwriting payload: must be a plain object');
  }

  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('Invalid scriptwriting payload: must not have a custom prototype');
  }

  const ownKeys = Reflect.ownKeys(raw);
  for (const k of ownKeys) {
    if (typeof k !== 'string') {
      throw new Error('Invalid scriptwriting payload: symbol properties are forbidden');
    }
    if (!ALLOWED_SCRIPTWRITING_KEYS.has(k)) {
      throw new Error(`Invalid scriptwriting payload: unknown property "${k}" is rejected`);
    }
    const desc = Object.getOwnPropertyDescriptor(raw, k);
    if (!desc || desc.get || desc.set) {
      throw new Error(`Invalid scriptwriting payload: accessor descriptor on "${k}" forbidden`);
    }
  }

  const obj = raw as Record<string, unknown>;

  const videoNum = Number(obj.videoNumber);
  if (![1, 2, 3, 4, 5].includes(videoNum)) {
    throw new Error('Invalid scriptwriting payload: videoNumber must be between 1 and 5');
  }

  const targetVariantCount = Number(obj.targetVariantCount ?? 1);
  if (![1, 2, 3].includes(targetVariantCount)) {
    throw new Error('Invalid scriptwriting payload: targetVariantCount must be between 1 and 3');
  }

  const reserved = Number(obj.reservedMicrounits);
  if (!Number.isSafeInteger(reserved) || reserved <= 0 || reserved > MAX_RESERVED_MICROUNITS) {
    throw new Error('Invalid scriptwriting payload: reservedMicrounits out of bounds');
  }

  if (typeof obj.briefHash !== 'string' || !/^[0-9a-f]{64}$/i.test(obj.briefHash)) {
    throw new Error('Invalid scriptwriting payload: briefHash must be a 64-char hex string');
  }

  if (typeof obj.assignmentId !== 'string' || obj.assignmentId.trim().length === 0) {
    throw new Error('Invalid scriptwriting payload: assignmentId must be a non-empty string');
  }

  if (obj.changeRequestId !== undefined && obj.changeRequestId !== null) {
    if (typeof obj.changeRequestId !== 'string' || obj.changeRequestId.trim().length === 0) {
      throw new Error('Invalid scriptwriting payload: changeRequestId must be a string');
    }
  }

  if (obj.changeInstruction !== undefined && obj.changeInstruction !== null) {
    if (typeof obj.changeInstruction !== 'string' || obj.changeInstruction.length > 2000) {
      throw new Error('Invalid scriptwriting payload: changeInstruction must be <= 2000 chars');
    }
  }

  return {
    workspaceId: parseWorkspaceId(obj.workspaceId),
    productId: parseProductId(obj.productId),
    workOrderId: parseWorkOrderId(obj.workOrderId),
    workItemId: parseWorkItemId(obj.workItemId),
    assignmentId: obj.assignmentId,
    videoNumber: videoNum as 1 | 2 | 3 | 4 | 5,
    targetVariantCount,
    changeRequestId: (obj.changeRequestId as string | undefined) ?? null,
    changeInstruction: (obj.changeInstruction as string | undefined) ?? null,
    reservedMicrounits: reserved,
    briefHash: obj.briefHash.toLowerCase(),
    operationId: parseOperationId(obj.operationId),
    aiRunId: parseAIRunId(obj.aiRunId),
  };
}

export function crossCheckScriptwritingPayload(
  payload: ValidatedScriptwritingPayload,
  job: JobExecutionSnapshot,
): void {
  if (payload.workspaceId !== job.workspaceId) {
    throw new Error('Scriptwriting payload workspaceId does not match job column');
  }
  if (payload.operationId !== job.operationId) {
    throw new Error('Scriptwriting payload operationId does not match job column');
  }
  if (payload.aiRunId !== job.aiRunId) {
    throw new Error('Scriptwriting payload aiRunId does not match job column');
  }
  if (payload.reservedMicrounits !== job.reservedSpendMicrounits) {
    throw new Error('Scriptwriting payload reservedMicrounits does not match job column');
  }
}
