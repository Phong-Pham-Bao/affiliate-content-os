import type { IsoTimestamp } from '../timestamps.js';
import type { UserId, WorkspaceId } from '../ids.js';
import type { AIRunId, OperationId } from './ids.js';

export const AI_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
export type AIRunStatus = (typeof AI_RUN_STATUSES)[number];

export function isAIRunStatus(value: unknown): value is AIRunStatus {
  return typeof value === 'string' && (AI_RUN_STATUSES as readonly string[]).includes(value);
}

export const AI_RUN_PURPOSES = ['product_analysis', 'niche_analysis'] as const;
export type AIRunPurpose = (typeof AI_RUN_PURPOSES)[number];

export function isAIRunPurpose(value: unknown): value is AIRunPurpose {
  return typeof value === 'string' && (AI_RUN_PURPOSES as readonly string[]).includes(value);
}

export const SAFE_FAILURE_CATEGORIES = [
  'ai_disabled',
  'budget_exhausted',
  'rate_limited',
  'provider_unavailable',
  'provider_timeout',
  'invalid_output',
  'invalid_evidence',
  'internal_error',
] as const;
export type SafeFailureCategory = (typeof SAFE_FAILURE_CATEGORIES)[number];

export function isSafeFailureCategory(value: unknown): value is SafeFailureCategory {
  return (
    typeof value === 'string' && (SAFE_FAILURE_CATEGORIES as readonly string[]).includes(value)
  );
}

export interface AIUsageSnapshot {
  readonly tokenInput: number;
  readonly tokenOutput: number;
  readonly costMicrounits: number;
  readonly costCurrency: string;
  readonly latencyMs: number;
}

export interface AIProvenanceSnapshot {
  readonly provider: string;
  readonly model: string;
  readonly promptTemplate: string;
  readonly promptVersion: string;
  readonly inputSchemaVersion: number;
  readonly outputSchemaVersion: number;
}

export interface AIRunSnapshot {
  readonly id: AIRunId;
  readonly workspaceId: WorkspaceId;
  readonly operationId: OperationId | null;
  readonly purpose: AIRunPurpose;
  readonly provider: string;
  readonly model: string;
  readonly promptTemplate: string;
  readonly promptVersion: string;
  readonly inputSchemaVersion: number;
  readonly outputSchemaVersion: number;
  readonly inputHash: Uint8Array;
  readonly outputHash: Uint8Array | null;
  readonly status: AIRunStatus;
  readonly attempt: number;
  readonly isRepair: boolean;
  readonly usage: AIUsageSnapshot | null;
  readonly safetyResult: string | null;
  readonly errorCategory: SafeFailureCategory | null;
  readonly requestedByUserId: UserId;
  readonly startedAt: IsoTimestamp | null;
  readonly completedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface WorkspaceAIPolicySnapshot {
  readonly workspaceId: WorkspaceId;
  readonly aiEnabled: boolean;
  readonly monthlyBudgetMicrounits: number;
  readonly currentSpendMicrounits: number;
  readonly reservedSpendMicrounits: number;
  readonly rateLimitPerMinute: number;
  readonly budgetPeriodStart: IsoTimestamp;
  readonly minuteWindowStart: IsoTimestamp;
  readonly minuteRequestCount: number;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface AIModelConfiguration {
  readonly provider: string;
  readonly model: string;
  readonly promptTemplate: string;
  readonly promptVersion: string;
  readonly inputSchemaVersion: number;
  readonly outputSchemaVersion: number;
  readonly estimatedCostMicrounits: number;
}
