import type {
  AnalysisDTO,
  AnalysisStatus,
  AnalysisSummaryDTO,
  AnalysisType,
  EnqueueAnalysisResponse,
  OperationDTO,
  OperationStatus,
  WorkspaceAIPolicyDTO,
} from '../types/analysis.js';
import {
  ApiError,
  isPlainObject,
  isValidRfc3339DateTime,
  isValidUuidV7,
} from './api-validators-common.js';

function createMalformedError(detail: string): ApiError {
  return new ApiError(200, {
    status: 200,
    title: 'Malformed Response',
    detail,
  });
}

function isAnalysisType(val: unknown): val is AnalysisType {
  return val === 'product' || val === 'niche' || val === 'performance';
}

function isAnalysisStatus(val: unknown): val is AnalysisStatus {
  return val === 'generated' || val === 'accepted' || val === 'rejected';
}

function isOperationStatus(val: unknown): val is OperationStatus {
  return val === 'queued' || val === 'running' || val === 'succeeded' || val === 'failed';
}

export function validateAnalysisSummary(data: unknown): AnalysisSummaryDTO {
  if (!isPlainObject(data)) throw createMalformedError('Analysis summary must be an object');
  if (typeof data.id !== 'string' || !isValidUuidV7(data.id))
    throw createMalformedError('Invalid analysis id');
  if (typeof data.productId !== 'string' || !isValidUuidV7(data.productId))
    throw createMalformedError('Invalid productId');
  if (!isAnalysisType(data.analysisType)) throw createMalformedError('Invalid analysisType');
  if (!isAnalysisStatus(data.status)) throw createMalformedError('Invalid analysis status');
  if (data.factSetRevision !== null && typeof data.factSetRevision !== 'number')
    throw createMalformedError('Invalid factSetRevision');
  if (data.provider !== null && typeof data.provider !== 'string')
    throw createMalformedError('Invalid provider');
  if (data.model !== null && typeof data.model !== 'string')
    throw createMalformedError('Invalid model');
  if (typeof data.version !== 'number') throw createMalformedError('Invalid version');
  if (typeof data.createdAt !== 'string' || !isValidRfc3339DateTime(data.createdAt))
    throw createMalformedError('Invalid createdAt');
  if (typeof data.updatedAt !== 'string' || !isValidRfc3339DateTime(data.updatedAt))
    throw createMalformedError('Invalid updatedAt');

  return {
    id: data.id,
    productId: data.productId,
    analysisType: data.analysisType,
    status: data.status,
    factSetRevision: data.factSetRevision,
    provider: data.provider,
    model: data.model,
    version: data.version,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function validateAnalysis(data: unknown): AnalysisDTO {
  if (!isPlainObject(data)) throw createMalformedError('Analysis must be an object');
  const summary = validateAnalysisSummary(data);
  if (typeof data.workspaceId !== 'string' || !isValidUuidV7(data.workspaceId))
    throw createMalformedError('Invalid workspaceId');
  if (typeof data.factSetId !== 'string' || !isValidUuidV7(data.factSetId))
    throw createMalformedError('Invalid factSetId');
  if (!isPlainObject(data.content))
    throw createMalformedError('Analysis content must be an object');
  if (data.contentHash !== null && typeof data.contentHash !== 'string')
    throw createMalformedError('Invalid contentHash');
  if (typeof data.isRepair !== 'boolean') throw createMalformedError('Invalid isRepair');

  return {
    ...summary,
    workspaceId: data.workspaceId,
    factSetId: data.factSetId,
    content: data.content as Record<string, unknown>,
    contentHash: data.contentHash,
    isRepair: data.isRepair,
    reviewedByUserId: typeof data.reviewedByUserId === 'string' ? data.reviewedByUserId : null,
    reviewedAt: typeof data.reviewedAt === 'string' ? data.reviewedAt : null,
    rejectionReason: typeof data.rejectionReason === 'string' ? data.rejectionReason : null,
  };
}

export function validateAnalysisList(data: unknown): {
  items: readonly AnalysisSummaryDTO[];
  page: { nextCursor: string | null; hasMore: boolean };
} {
  if (!isPlainObject(data)) throw createMalformedError('Analysis list must be an object');
  if (!Array.isArray(data.items)) throw createMalformedError('items must be an array');
  const items = data.items.map(validateAnalysisSummary);
  const nextCursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
  return {
    items,
    page: { nextCursor, hasMore: Boolean(nextCursor) },
  };
}

export function validateOperation(data: unknown): OperationDTO {
  if (!isPlainObject(data)) throw createMalformedError('Operation must be an object');
  if (typeof data.id !== 'string' || !isValidUuidV7(data.id))
    throw createMalformedError('Invalid operation id');
  if (typeof data.workspaceId !== 'string' || !isValidUuidV7(data.workspaceId))
    throw createMalformedError('Invalid workspaceId');
  if (typeof data.operationType !== 'string') throw createMalformedError('Invalid operationType');
  if (!isOperationStatus(data.status)) throw createMalformedError('Invalid operation status');
  if (typeof data.resourceId !== 'string') throw createMalformedError('Invalid resourceId');
  if (typeof data.resourceType !== 'string') throw createMalformedError('Invalid resourceType');
  if (typeof data.version !== 'number') throw createMalformedError('Invalid version');
  if (typeof data.createdAt !== 'string' || !isValidRfc3339DateTime(data.createdAt))
    throw createMalformedError('Invalid createdAt');
  if (typeof data.updatedAt !== 'string' || !isValidRfc3339DateTime(data.updatedAt))
    throw createMalformedError('Invalid updatedAt');

  return {
    id: data.id,
    workspaceId: data.workspaceId,
    operationType: data.operationType,
    status: data.status,
    resourceId: data.resourceId,
    resourceType: data.resourceType,
    progressPercent: typeof data.progressPercent === 'number' ? data.progressPercent : null,
    resultLocation: typeof data.resultLocation === 'string' ? data.resultLocation : null,
    errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
    errorCategory: typeof data.errorCategory === 'string' ? data.errorCategory : null,
    errorMessage: typeof data.errorMessage === 'string' ? data.errorMessage : null,
    startedAt: typeof data.startedAt === 'string' ? data.startedAt : null,
    completedAt: typeof data.completedAt === 'string' ? data.completedAt : null,
    version: data.version,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function validateEnqueueResponse(data: unknown): EnqueueAnalysisResponse {
  if (!isPlainObject(data)) throw createMalformedError('Enqueue response must be an object');
  if (typeof data.operationId !== 'string' || !isValidUuidV7(data.operationId))
    throw createMalformedError('Invalid operationId');
  if (typeof data.location !== 'string') throw createMalformedError('Invalid location');
  if (!isOperationStatus(data.status)) throw createMalformedError('Invalid status');

  return {
    operationId: data.operationId,
    location: data.location,
    status: data.status,
  };
}

export function validateAIPolicy(data: unknown): WorkspaceAIPolicyDTO {
  if (!isPlainObject(data)) throw createMalformedError('AI policy must be an object');
  if (typeof data.workspaceId !== 'string' || !isValidUuidV7(data.workspaceId))
    throw createMalformedError('Invalid workspaceId');
  if (typeof data.aiEnabled !== 'boolean') throw createMalformedError('Invalid aiEnabled');
  if (typeof data.monthlyBudgetMicrounits !== 'number')
    throw createMalformedError('Invalid monthlyBudgetMicrounits');
  if (typeof data.currentSpendMicrounits !== 'number')
    throw createMalformedError('Invalid currentSpendMicrounits');
  if (typeof data.reservedSpendMicrounits !== 'number')
    throw createMalformedError('Invalid reservedSpendMicrounits');
  if (typeof data.rateLimitPerMinute !== 'number')
    throw createMalformedError('Invalid rateLimitPerMinute');
  if (typeof data.budgetPeriodStart !== 'string')
    throw createMalformedError('Invalid budgetPeriodStart');
  if (typeof data.updatedAt !== 'string') throw createMalformedError('Invalid updatedAt');
  if (typeof data.version !== 'number') throw createMalformedError('Invalid version');

  return {
    workspaceId: data.workspaceId,
    aiEnabled: data.aiEnabled,
    monthlyBudgetMicrounits: data.monthlyBudgetMicrounits,
    currentSpendMicrounits: data.currentSpendMicrounits,
    reservedSpendMicrounits: data.reservedSpendMicrounits,
    rateLimitPerMinute: data.rateLimitPerMinute,
    budgetPeriodStart: data.budgetPeriodStart,
    updatedAt: data.updatedAt,
    version: data.version,
  };
}
