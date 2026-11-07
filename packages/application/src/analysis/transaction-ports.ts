import type {
  AIRunId,
  JobExecutionId,
  OperationId,
  SafeFailureCategory,
  UserId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type { CreateAIRunParams, CreateOperationParams } from './operation-persistence-port.js';
import type { CreateAnalysisRecordParams } from './analysis-persistence-port.js';

export interface EnqueueAnalysisAtomicParams {
  readonly operation: CreateOperationParams;
  readonly aiRun: CreateAIRunParams;
  readonly job: {
    readonly id: JobExecutionId;
    readonly workspaceId: WorkspaceId;
    readonly operationId: OperationId;
    readonly aiRunId: AIRunId;
    readonly jobType: string;
    readonly deduplicationKey: string;
    readonly reservedSpendMicrounits: number;
    readonly payloadJson: Record<string, unknown>;
  };
  readonly outboxEvent: {
    readonly id: string;
    readonly workspaceId: WorkspaceId;
    readonly eventType: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly payloadJson: Record<string, unknown>;
  };
  readonly idempotency: {
    readonly keyHash: Uint8Array;
    readonly requestHash: Uint8Array;
    readonly principalId: UserId;
    readonly routeKey: string;
    readonly statusCode: number;
    readonly responseJson: Record<string, unknown>;
    readonly resourceId: string;
  };
  readonly estimatedCostMicrounits: number;
  readonly auditEvent: {
    readonly id: string;
    readonly workspaceId: WorkspaceId;
    readonly actorUserId: UserId;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly changesJson: Record<string, unknown>;
  };
}

export interface EnqueueAnalysisTransactionResult {
  readonly operationId: OperationId;
  readonly aiRunId?: AIRunId | undefined;
  readonly jobId?: JobExecutionId | undefined;
  readonly cached?: boolean | undefined;
}

export interface EnqueueAnalysisTransactionPort {
  enqueueAnalysisAtomic(
    params: EnqueueAnalysisAtomicParams,
  ): Promise<EnqueueAnalysisTransactionResult>;
}

export interface PersistExecutionSuccessOutcome {
  readonly kind: 'success';
  readonly analysis: CreateAnalysisRecordParams;
  readonly outputHash: Uint8Array;
  readonly usage?:
    | {
        readonly tokenInput?: number | undefined;
        readonly tokenOutput?: number | undefined;
        readonly costMicrounits?: number | undefined;
        readonly costCurrency?: string | undefined;
        readonly latencyMs?: number | undefined;
      }
    | undefined;
  readonly safetyResult?: string | null | undefined;
  readonly resultLocation: string;
  readonly reservedMicrounits: number;
  readonly actualSpendMicrounits: number;
  readonly auditEvent: {
    readonly id: string;
    readonly workspaceId: WorkspaceId;
    readonly actorUserId: UserId;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly result: 'succeeded';
    readonly changesJson: Record<string, unknown>;
  };
}

export interface PersistExecutionRetryOutcome {
  readonly kind: 'retry';
  readonly errorCategory: 'provider_unavailable' | 'provider_timeout' | 'rate_limited';
  readonly retryDelaySeconds: number;
  readonly reservedMicrounits: number;
}

export interface PersistExecutionRepairOutcome {
  readonly kind: 'repair';
  readonly errorCategory: 'invalid_output';
  readonly repairDelaySeconds: number;
  readonly reservedMicrounits: number;
}

export interface PersistExecutionTerminalFailureOutcome {
  readonly kind: 'terminal_failure';
  readonly errorCategory: SafeFailureCategory;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly usage?:
    | {
        readonly tokenInput?: number | undefined;
        readonly tokenOutput?: number | undefined;
        readonly costMicrounits?: number | undefined;
        readonly costCurrency?: string | undefined;
        readonly latencyMs?: number | undefined;
      }
    | undefined;
  readonly reservedMicrounits: number;
  readonly actualSpendMicrounits: number;
  readonly auditEvent: {
    readonly id: string;
    readonly workspaceId: WorkspaceId;
    readonly actorUserId?: UserId | null | undefined;
    readonly actorType?: 'user' | 'system' | undefined;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly result: 'failed';
    readonly changesJson: Record<string, unknown>;
  };
}

export type PersistExecutionOutcome =
  | PersistExecutionSuccessOutcome
  | PersistExecutionRetryOutcome
  | PersistExecutionRepairOutcome
  | PersistExecutionTerminalFailureOutcome;

export interface PersistExecutionResultAtomicParams {
  readonly workspaceId: WorkspaceId;
  readonly operationId: OperationId;
  readonly aiRunId: AIRunId;
  readonly jobId: JobExecutionId;
  readonly jobVersion: number;
  readonly workerId: string;
  readonly outcome: PersistExecutionOutcome;
}

export type PersistExecutionTransactionResult =
  | { readonly outcome: 'succeeded' }
  | { readonly outcome: 'retried'; readonly delaySeconds: number }
  | { readonly outcome: 'repaired'; readonly delaySeconds: number }
  | { readonly outcome: 'failed'; readonly errorCategory: SafeFailureCategory };

export interface PersistExecutionResultTransactionPort {
  persistExecutionResultAtomic(
    params: PersistExecutionResultAtomicParams,
  ): Promise<PersistExecutionTransactionResult>;
}
