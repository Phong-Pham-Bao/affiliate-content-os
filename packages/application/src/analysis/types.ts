import type {
  AIModelConfiguration,
  AIRunId,
  AnalysisStatus,
  AnalysisType,
  JobExecutionId,
  OperationId,
  ProductFactSetId,
  ProductId,
  UserId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type {
  AIAnalysisGatewayResult,
  AIRunPersistencePort,
  AnalysisPersistencePort,
  EnqueueAnalysisTransactionPort,
  PersistExecutionResultTransactionPort,
} from './ports.js';
import type { CatalogPersistencePort } from '../catalog/ports.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';

export interface EnqueueAnalysisCommand {
  readonly workspaceId: string;
  readonly productId: string;
  readonly analysisType: 'product' | 'niche';
  readonly factSetId: string;
  readonly sourceAnalysisIds?: readonly string[] | undefined;
  readonly idempotencyKey: string;
  readonly actorUserId: string;
}

export interface EnqueueAnalysisDependencies {
  readonly authPort: WorkspaceAuthorizationPort;
  readonly catalogPort: CatalogPersistencePort;
  readonly analysisPort: AnalysisPersistencePort;
  readonly enqueueTxPort: EnqueueAnalysisTransactionPort;
  readonly idGenerator?: IdGeneratorPort | undefined;
  readonly clock: ClockPort;
  readonly aiModelConfig: AIModelConfiguration;
}

export interface EnqueueAnalysisResult {
  readonly operationId: OperationId;
  readonly location: string;
}

export interface PersistAIExecutionResultCommand {
  readonly workspaceId: WorkspaceId;
  readonly operationId: OperationId;
  readonly aiRunId: AIRunId;
  readonly jobId: JobExecutionId;
  readonly jobVersion: number;
  readonly workerId: string;
  readonly productId: ProductId;
  readonly analysisType: 'product' | 'niche';
  readonly factSetId: ProductFactSetId;
  readonly sourceAnalysisIds?: readonly string[] | undefined;
  readonly actorUserId: UserId;
  readonly gatewayResult: AIAnalysisGatewayResult<unknown>;
  readonly attemptCount: number;
  readonly reservedMicrounits: number;
  readonly repairAttemptCount?: number | undefined;
}

export interface PersistAIExecutionResultDependencies {
  readonly catalogPort: CatalogPersistencePort;
  readonly analysisPort: AnalysisPersistencePort;
  readonly aiRunPort: AIRunPersistencePort;
  readonly persistTxPort: PersistExecutionResultTransactionPort;
  readonly idGenerator?: IdGeneratorPort | undefined;
  readonly clock: ClockPort;
}

export interface ReviewAnalysisCommand {
  readonly workspaceId: string;
  readonly analysisId: string;
  readonly decision: 'accepted' | 'rejected';
  readonly expectedVersion: number;
  readonly reason?: string | null | undefined;
  readonly actorUserId: string;
}

export interface ReviewAnalysisDependencies {
  readonly authPort: WorkspaceAuthorizationPort;
  readonly analysisPort: AnalysisPersistencePort;
  readonly idGenerator?: IdGeneratorPort | undefined;
  readonly clock: ClockPort;
}

export interface ListAnalysesQuery {
  readonly workspaceId: string;
  readonly productId: string;
  readonly analysisType?: AnalysisType | undefined;
  readonly status?: AnalysisStatus | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly actorUserId: string;
}

export interface ListAnalysesDependencies {
  readonly authPort: WorkspaceAuthorizationPort;
  readonly catalogPort: CatalogPersistencePort;
  readonly analysisPort: AnalysisPersistencePort;
}

export interface GetAnalysisQuery {
  readonly workspaceId: string;
  readonly analysisId: string;
  readonly actorUserId: string;
}

export interface GetAnalysisDependencies {
  readonly authPort: WorkspaceAuthorizationPort;
  readonly analysisPort: AnalysisPersistencePort;
}

export interface GetOperationQuery {
  readonly workspaceId: string;
  readonly operationId: string;
  readonly actorUserId: string;
}

export interface GetOperationDependencies {
  readonly authPort: WorkspaceAuthorizationPort;
  readonly operationPort: {
    getOperationById(
      workspaceId: WorkspaceId,
      operationId: OperationId,
    ): Promise<import('@affiliate-content-os/domain').OperationSnapshot | null>;
  };
}
