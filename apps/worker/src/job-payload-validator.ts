import {
  parseAIRunId,
  parseAnalysisId,
  parseOperationId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type AIRunId,
  type AnalysisId,
  type JobExecutionSnapshot,
  type OperationId,
  type ProductFactSetId,
  type ProductId,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';

export interface ValidatedJobPayload {
  readonly operationId: OperationId;
  readonly aiRunId: AIRunId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly analysisType: 'product' | 'niche';
  readonly factSetId: ProductFactSetId;
  readonly sourceAnalysisIds: readonly AnalysisId[];
  readonly actorUserId: UserId;
  readonly reservedMicrounits: number;
}

const ALLOWED_KEYS = new Set([
  'operationId',
  'aiRunId',
  'workspaceId',
  'productId',
  'analysisType',
  'factSetId',
  'sourceAnalysisIds',
  'actorUserId',
  'reservedMicrounits',
]);

const MAX_RESERVED_MICROUNITS = 100_000_000_000; // 100,000 USD
const MAX_SOURCE_ANALYSES = 10;

export function parseAndValidateJobPayload(raw: unknown): ValidatedJobPayload {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid job payload: must be a plain JSON object');
  }

  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('Invalid job payload: must not have a custom prototype');
  }

  const ownKeys = Reflect.ownKeys(raw);
  for (const k of ownKeys) {
    if (typeof k !== 'string') {
      throw new Error('Invalid job payload: symbol properties are forbidden');
    }
    if (!ALLOWED_KEYS.has(k)) {
      throw new Error(`Invalid job payload: unknown property "${k}" is rejected`);
    }
    const desc = Object.getOwnPropertyDescriptor(raw, k);
    if (!desc || desc.get || desc.set) {
      throw new Error(`Invalid job payload: accessor descriptor on "${k}" is forbidden`);
    }
  }

  const obj = raw as Record<string, unknown>;

  if (obj.analysisType !== 'product' && obj.analysisType !== 'niche') {
    throw new Error(`Invalid job payload: unsupported analysisType`);
  }

  if (typeof obj.operationId !== 'string') {
    throw new Error('Invalid job payload: operationId must be a string');
  }
  if (typeof obj.aiRunId !== 'string') {
    throw new Error('Invalid job payload: aiRunId must be a string');
  }
  if (typeof obj.workspaceId !== 'string') {
    throw new Error('Invalid job payload: workspaceId must be a string');
  }
  if (typeof obj.productId !== 'string') {
    throw new Error('Invalid job payload: productId must be a string');
  }
  if (typeof obj.factSetId !== 'string') {
    throw new Error('Invalid job payload: factSetId must be a string');
  }
  if (typeof obj.actorUserId !== 'string') {
    throw new Error('Invalid job payload: actorUserId must be a string');
  }

  if (
    typeof obj.reservedMicrounits !== 'number' ||
    !Number.isSafeInteger(obj.reservedMicrounits) ||
    obj.reservedMicrounits < 0 ||
    obj.reservedMicrounits > MAX_RESERVED_MICROUNITS
  ) {
    throw new Error(
      'Invalid job payload: reservedMicrounits must be a bounded safe non-negative integer',
    );
  }

  const operationId = parseOperationId(obj.operationId);
  const aiRunId = parseAIRunId(obj.aiRunId);
  const workspaceId = parseWorkspaceId(obj.workspaceId);
  const productId = parseProductId(obj.productId);
  const factSetId = parseProductFactSetId(obj.factSetId);
  const actorUserId = parseUserId(obj.actorUserId);

  let sourceAnalysisIds: AnalysisId[] = [];
  if (obj.analysisType === 'product') {
    if (obj.sourceAnalysisIds !== undefined) {
      if (!Array.isArray(obj.sourceAnalysisIds) || obj.sourceAnalysisIds.length > 0) {
        throw new Error('Invalid job payload: product analysis must not contain sourceAnalysisIds');
      }
    }
  } else {
    if (obj.sourceAnalysisIds !== undefined) {
      if (!Array.isArray(obj.sourceAnalysisIds)) {
        throw new Error('Invalid job payload: sourceAnalysisIds must be an array');
      }
      if (obj.sourceAnalysisIds.length > MAX_SOURCE_ANALYSES) {
        throw new Error(
          `Invalid job payload: sourceAnalysisIds exceeds max allowed of ${MAX_SOURCE_ANALYSES}`,
        );
      }
      for (const id of obj.sourceAnalysisIds) {
        if (typeof id !== 'string') {
          throw new Error('Invalid job payload: each sourceAnalysisId must be a string');
        }
        sourceAnalysisIds.push(parseAnalysisId(id));
      }
      // Deduplicate and sort branded IDs
      sourceAnalysisIds = [...new Set(sourceAnalysisIds)].sort();
    }
  }

  return Object.freeze({
    operationId,
    aiRunId,
    workspaceId,
    productId,
    analysisType: obj.analysisType,
    factSetId,
    sourceAnalysisIds: Object.freeze(sourceAnalysisIds),
    actorUserId,
    reservedMicrounits: obj.reservedMicrounits,
  });
}

export function crossCheckJobPayload(
  payload: ValidatedJobPayload,
  job: JobExecutionSnapshot,
): void {
  if (payload.workspaceId !== job.workspaceId) {
    throw new Error('Job payload workspaceId does not match job column');
  }
  if (payload.operationId !== job.operationId) {
    throw new Error('Job payload operationId does not match job column');
  }
  if (payload.aiRunId !== job.aiRunId) {
    throw new Error('Job payload aiRunId does not match job column');
  }
  if (payload.reservedMicrounits !== job.reservedSpendMicrounits) {
    throw new Error('Job payload reservedMicrounits does not match job column');
  }
}
