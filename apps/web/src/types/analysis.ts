export type AnalysisType = 'product' | 'niche' | 'performance';
export type AnalysisStatus = 'generated' | 'accepted' | 'rejected';

export interface AnalysisSummaryDTO {
  readonly id: string;
  readonly productId: string;
  readonly analysisType: AnalysisType;
  readonly status: AnalysisStatus;
  readonly factSetRevision: number | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly productId: string;
  readonly analysisType: AnalysisType;
  readonly status: AnalysisStatus;
  readonly factSetId: string;
  readonly factSetRevision: number | null;
  readonly content: Record<string, unknown>;
  readonly contentHash: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly isRepair: boolean;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly rejectionReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface OperationDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly operationType: string;
  readonly status: OperationStatus;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly progressPercent: number | null;
  readonly resultLocation?: string | null;
  readonly errorCode: string | null;
  readonly errorCategory: string | null;
  readonly errorMessage: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnqueueAnalysisPayload {
  readonly analysisType: 'product' | 'niche';
  readonly factSetId: string;
  readonly sourceAnalysisIds?: readonly string[] | undefined;
}

export interface EnqueueAnalysisResponse {
  readonly operationId: string;
  readonly location: string;
  readonly status: OperationStatus;
}

export interface WorkspaceAIPolicyDTO {
  readonly workspaceId: string;
  readonly aiEnabled: boolean;
  readonly monthlyBudgetMicrounits: number;
  readonly currentSpendMicrounits: number;
  readonly reservedSpendMicrounits: number;
  readonly rateLimitPerMinute: number;
  readonly budgetPeriodStart: string;
  readonly updatedAt: string;
  readonly version: number;
}
