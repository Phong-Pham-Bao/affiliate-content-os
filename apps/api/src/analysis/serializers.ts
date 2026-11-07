import type {
  AIRunSnapshot,
  AnalysisSnapshot,
  OperationSnapshot,
  WorkspaceAIPolicySnapshot,
} from '@affiliate-content-os/domain';

export function serializeAnalysis(
  analysis: AnalysisSnapshot,
  run?: AIRunSnapshot | null,
  factSetRevision?: number | null,
): Record<string, unknown> {
  return {
    id: analysis.id,
    workspaceId: analysis.workspaceId,
    productId: analysis.productId,
    analysisType: analysis.analysisType,
    revisionNumber: analysis.revisionNumber,
    factSetRevision: factSetRevision ?? null,
    factSetId: analysis.factSetId,
    aiRunId: analysis.aiRunId,
    content: analysis.contentJson,
    schemaVersion: analysis.schemaVersion,
    status: analysis.status,
    reviewedByUserId: analysis.reviewedByUserId,
    reviewedAt: analysis.reviewedAt,
    reviewReason: analysis.reviewReason,
    rejectionReason: analysis.reviewReason,
    provider: run?.provider ?? null,
    model: run?.model ?? null,
    isRepair: run?.isRepair ?? false,
    contentHash: run?.outputHash ? Buffer.from(run.outputHash).toString('hex') : null,
    createdByUserId: analysis.createdByUserId,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    version: analysis.version,
    provenance: run
      ? {
          provider: run.provider,
          model: run.model,
          promptTemplate: run.promptTemplate,
          promptVersion: run.promptVersion,
        }
      : undefined,
  };
}

export function serializeAnalysisSummary(
  analysis: AnalysisSnapshot,
  run?: AIRunSnapshot | null,
  factSetRevision?: number | null,
): Record<string, unknown> {
  return {
    id: analysis.id,
    workspaceId: analysis.workspaceId,
    productId: analysis.productId,
    analysisType: analysis.analysisType,
    revisionNumber: analysis.revisionNumber,
    factSetId: analysis.factSetId,
    factSetRevision: factSetRevision ?? null,
    provider: run?.provider ?? null,
    model: run?.model ?? null,
    status: analysis.status,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    version: analysis.version,
  };
}

export function serializeOperation(op: OperationSnapshot): Record<string, unknown> {
  return {
    id: op.id,
    workspaceId: op.workspaceId,
    operationType: op.operationType,
    resourceType: op.resourceType,
    resourceId: op.resourceId,
    status: op.status,
    progressPercent: op.progressPercent,
    resultLocation: op.resultLocation,
    errorCategory: op.errorCategory,
    errorCode: op.errorCode,
    errorMessage: op.errorMessage,
    startedAt: op.startedAt,
    completedAt: op.completedAt,
    createdAt: op.createdAt,
    updatedAt: op.updatedAt,
    version: op.version,
  };
}

export function serializeAIPolicy(policy: WorkspaceAIPolicySnapshot): Record<string, unknown> {
  return {
    workspaceId: policy.workspaceId,
    aiEnabled: policy.aiEnabled,
    monthlyBudgetMicrounits: policy.monthlyBudgetMicrounits,
    currentSpendMicrounits: policy.currentSpendMicrounits,
    reservedSpendMicrounits: policy.reservedSpendMicrounits,
    rateLimitPerMinute: policy.rateLimitPerMinute,
    budgetPeriodStart: policy.budgetPeriodStart,
    updatedAt: policy.updatedAt,
    version: policy.version,
  };
}
