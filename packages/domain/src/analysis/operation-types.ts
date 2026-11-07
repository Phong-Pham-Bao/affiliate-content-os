import type { IsoTimestamp } from '../timestamps.js';
import type { CorrelationId, UserId, WorkspaceId } from '../ids.js';
import type { ProductId } from '../catalog/ids.js';
import type { AIRunId, JobExecutionId, OperationId } from './ids.js';
import type { SafeFailureCategory } from './ai-run-types.js';

export const OPERATION_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export function isOperationStatus(value: unknown): value is OperationStatus {
  return typeof value === 'string' && (OPERATION_STATUSES as readonly string[]).includes(value);
}

export const OPERATION_TYPES = ['product_analysis', 'niche_analysis'] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export function isOperationType(value: unknown): value is OperationType {
  return typeof value === 'string' && (OPERATION_TYPES as readonly string[]).includes(value);
}

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'retry_wait'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);
}

export interface OperationSnapshot {
  readonly id: OperationId;
  readonly workspaceId: WorkspaceId;
  readonly operationType: OperationType;
  readonly resourceType: 'product';
  readonly resourceId: ProductId;
  readonly status: OperationStatus;
  readonly progressPercent: number | null;
  readonly resultLocation: string | null;
  readonly errorCategory: SafeFailureCategory | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly requestedByUserId: UserId;
  readonly startedAt: IsoTimestamp | null;
  readonly completedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface JobExecutionSnapshot {
  readonly id: JobExecutionId;
  readonly workspaceId: WorkspaceId;
  readonly operationId: OperationId;
  readonly aiRunId: AIRunId;
  readonly jobType: string;
  readonly deduplicationKey: string;
  readonly status: JobStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly repairAttempt: number;
  readonly maxRepairAttempts: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: IsoTimestamp | null;
  readonly nextAttemptAt: IsoTimestamp;
  readonly startedAt: IsoTimestamp | null;
  readonly completedAt: IsoTimestamp | null;
  readonly lastErrorCategory: SafeFailureCategory | null;
  readonly payloadJson: Record<string, unknown>;
  readonly correlationId: CorrelationId | null;
  readonly reservedSpendMicrounits: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}
