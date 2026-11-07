import type {
  AIRunId,
  AIRunSnapshot,
  AIRunStatus,
  AIUsageSnapshot,
  JobExecutionSnapshot,
  OperationId,
  OperationSnapshot,
  OperationStatus,
  ProductId,
  SafeFailureCategory,
  UserId,
  AuditEventId,
  WorkspaceAIPolicySnapshot,
  WorkspaceId,
} from '@affiliate-content-os/domain';

export interface CreateOperationParams {
  readonly id: OperationId;
  readonly workspaceId: WorkspaceId;
  readonly operationType: 'product_analysis' | 'niche_analysis';
  readonly resourceType: 'product';
  readonly resourceId: ProductId;
  readonly requestedByUserId: UserId;
}

export interface UpdateOperationStatusParams {
  readonly workspaceId: WorkspaceId;
  readonly operationId: OperationId;
  readonly status: OperationStatus;
  readonly progressPercent?: number | null | undefined;
  readonly resultLocation?: string | null | undefined;
  readonly errorCategory?: SafeFailureCategory | null | undefined;
  readonly errorCode?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly completedAt?: string | null | undefined;
}

export interface OperationPersistencePort {
  getOperationById(
    workspaceId: WorkspaceId,
    operationId: OperationId,
  ): Promise<OperationSnapshot | null>;
}

export interface CreateAIRunParams {
  readonly id: AIRunId;
  readonly workspaceId: WorkspaceId;
  readonly operationId: OperationId;
  readonly purpose: 'product_analysis' | 'niche_analysis';
  readonly provider: string;
  readonly model: string;
  readonly promptTemplate: string;
  readonly promptVersion: string;
  readonly inputSchemaVersion: number;
  readonly outputSchemaVersion: number;
  readonly inputHash: Uint8Array;
  readonly requestedByUserId: UserId;
}

export interface UpdateAIRunStatusParams {
  readonly workspaceId: WorkspaceId;
  readonly aiRunId: AIRunId;
  readonly status: AIRunStatus;
  readonly outputHash?: Uint8Array | null | undefined;
  readonly usage?: AIUsageSnapshot | null | undefined;
  readonly safetyResult?: string | null | undefined;
  readonly errorCategory?: SafeFailureCategory | null | undefined;
  readonly completedAt?: string | null | undefined;
}

export interface AIRunPersistencePort {
  getAIRunById(workspaceId: WorkspaceId, aiRunId: AIRunId): Promise<AIRunSnapshot | null>;
}

export interface WorkspaceAIPolicyPort {
  getPolicy(workspaceId: WorkspaceId): Promise<WorkspaceAIPolicySnapshot>;
  updatePolicy?(params: {
    readonly workspaceId: WorkspaceId;
    readonly aiEnabled: boolean;
    readonly monthlyBudgetMicrounits: number;
    readonly rateLimitPerMinute: number;
    readonly expectedVersion: number;
    readonly actorUserId: UserId;
    readonly auditEventId: AuditEventId;
  }): Promise<WorkspaceAIPolicySnapshot>;
}

export interface ClaimJobParams {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
}

export interface DurableJobQueuePort {
  claimNextJob(params: ClaimJobParams): Promise<JobExecutionSnapshot | null>;
}
