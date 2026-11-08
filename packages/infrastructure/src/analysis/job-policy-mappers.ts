import {
  parseAIRunId,
  parseCorrelationId,
  parseJobExecutionId,
  parseOperationId,
  parseWorkspaceId,
  type JobExecutionSnapshot,
  type JobStatus,
  type SafeFailureCategory,
  type WorkspaceAIPolicySnapshot,
  JOB_STATUSES,
  SAFE_FAILURE_CATEGORIES,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import {
  extractOwnRowProperties,
  mapSafeTimestamp,
  validateEnum,
  validateSafeVersion,
  validateUuid,
} from '../catalog/mapper-helpers.js';
import { deepFreeze, validateSafeInteger } from './mapper-safety.js';

export function parseSafeBigIntNumber(val: unknown, fieldName: string): number {
  if (typeof val === 'number') {
    if (!Number.isSafeInteger(val) || val < 0) {
      throw new DatabaseError(`Invalid numeric value for ${fieldName}`);
    }
    return val;
  }
  if (typeof val === 'string') {
    if (!/^\d+$/.test(val)) {
      throw new DatabaseError(`Invalid numeric string for ${fieldName}`);
    }
    const num = Number(val);
    if (!Number.isSafeInteger(num) || num < 0) {
      throw new DatabaseError(`Integer overflow for ${fieldName}`);
    }
    return num;
  }
  throw new DatabaseError(`Invalid type for ${fieldName}`);
}

const POLICY_COLS = [
  'workspace_id',
  'ai_enabled',
  'monthly_budget_microunits',
  'current_spend_microunits',
  'reserved_spend_microunits',
  'rate_limit_per_minute',
  'budget_period_start',
  'minute_window_start',
  'minute_request_count',
  'updated_at',
  'version',
] as const;

export function mapWorkspaceAIPolicyRow(row: unknown): WorkspaceAIPolicySnapshot {
  const v = extractOwnRowProperties(row, POLICY_COLS);
  return Object.freeze({
    workspaceId: parseWorkspaceId(
      validateUuid(v['workspace_id'], 'workspace_ai_policies.workspace_id'),
    ),
    aiEnabled: Boolean(v['ai_enabled']),
    monthlyBudgetMicrounits: parseSafeBigIntNumber(
      v['monthly_budget_microunits'],
      'workspace_ai_policies.monthly_budget_microunits',
    ),
    currentSpendMicrounits: parseSafeBigIntNumber(
      v['current_spend_microunits'],
      'workspace_ai_policies.current_spend_microunits',
    ),
    reservedSpendMicrounits: parseSafeBigIntNumber(
      v['reserved_spend_microunits'],
      'workspace_ai_policies.reserved_spend_microunits',
    ),
    rateLimitPerMinute: validateSafeInteger(
      v['rate_limit_per_minute'],
      'workspace_ai_policies.rate_limit_per_minute',
      1,
      100_000,
    ),
    budgetPeriodStart: mapSafeTimestamp(
      v['budget_period_start'],
      'workspace_ai_policies.budget_period_start',
    ),
    minuteWindowStart: mapSafeTimestamp(
      v['minute_window_start'],
      'workspace_ai_policies.minute_window_start',
    ),
    minuteRequestCount: validateSafeInteger(
      v['minute_request_count'],
      'workspace_ai_policies.minute_request_count',
      0,
      100_000,
    ),
    updatedAt: mapSafeTimestamp(v['updated_at'], 'workspace_ai_policies.updated_at'),
    version: validateSafeVersion(v['version'], 'workspace_ai_policies.version'),
  });
}

const JOB_COLS = [
  'id',
  'workspace_id',
  'operation_id',
  'ai_run_id',
  'job_type',
  'deduplication_key',
  'status',
  'attempt',
  'max_attempts',
  'repair_attempt',
  'max_repair_attempts',
  'lease_owner',
  'lease_expires_at',
  'next_attempt_at',
  'started_at',
  'completed_at',
  'last_error_category',
  'payload_json',
  'correlation_id',
  'reserved_spend_microunits',
  'created_at',
  'updated_at',
  'version',
  'work_order_id',
  'work_item_id',
] as const;

export function mapJobExecutionRow(row: unknown): JobExecutionSnapshot {
  const v = extractOwnRowProperties(row, JOB_COLS);
  const status = validateEnum<JobStatus>(v['status'], 'job_executions.status', JOB_STATUSES);

  let lastErrorCategory: SafeFailureCategory | null = null;
  if (v['last_error_category'] !== null && v['last_error_category'] !== undefined) {
    lastErrorCategory = validateEnum<SafeFailureCategory>(
      v['last_error_category'],
      'job_executions.last_error_category',
      SAFE_FAILURE_CATEGORIES,
    );
  }

  const payload =
    typeof v['payload_json'] === 'string' ? JSON.parse(v['payload_json']) : v['payload_json'];

  return Object.freeze({
    id: parseJobExecutionId(validateUuid(v['id'], 'job_executions.id')),
    workspaceId: parseWorkspaceId(validateUuid(v['workspace_id'], 'job_executions.workspace_id')),
    operationId: parseOperationId(validateUuid(v['operation_id'], 'job_executions.operation_id')),
    aiRunId: parseAIRunId(validateUuid(v['ai_run_id'], 'job_executions.ai_run_id')),
    jobType: String(v['job_type']),
    deduplicationKey: String(v['deduplication_key']),
    status,
    attempt: validateSafeInteger(v['attempt'], 'job_executions.attempt', 0, 1000),
    maxAttempts: validateSafeInteger(v['max_attempts'], 'job_executions.max_attempts', 1, 1000),
    repairAttempt: validateSafeInteger(
      v['repair_attempt'] ?? 0,
      'job_executions.repair_attempt',
      0,
      10,
    ),
    maxRepairAttempts: validateSafeInteger(
      v['max_repair_attempts'] ?? 1,
      'job_executions.max_repair_attempts',
      1,
      10,
    ),
    leaseOwner: v['lease_owner'] ? String(v['lease_owner']) : null,
    leaseExpiresAt: v['lease_expires_at']
      ? mapSafeTimestamp(v['lease_expires_at'], 'job_executions.lease_expires_at')
      : null,
    nextAttemptAt: mapSafeTimestamp(v['next_attempt_at'], 'job_executions.next_attempt_at'),
    startedAt: v['started_at']
      ? mapSafeTimestamp(v['started_at'], 'job_executions.started_at')
      : null,
    completedAt: v['completed_at']
      ? mapSafeTimestamp(v['completed_at'], 'job_executions.completed_at')
      : null,
    lastErrorCategory,
    payloadJson: deepFreeze(payload ?? {}),
    correlationId: v['correlation_id'] ? parseCorrelationId(v['correlation_id']) : null,
    reservedSpendMicrounits: validateSafeInteger(
      v['reserved_spend_microunits'] ?? 0,
      'job_executions.reserved_spend_microunits',
      0,
      100_000_000_000,
    ),
    createdAt: mapSafeTimestamp(v['created_at'], 'job_executions.created_at'),
    updatedAt: mapSafeTimestamp(v['updated_at'], 'job_executions.updated_at'),
    version: validateSafeVersion(v['version'], 'job_executions.version'),
  });
}
