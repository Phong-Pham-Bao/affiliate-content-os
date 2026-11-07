import {
  parseAIRunId,
  parseOperationId,
  parseUserId,
  parseWorkspaceId,
  type AIRunPurpose,
  type AIRunSnapshot,
  type AIRunStatus,
  type SafeFailureCategory,
  AI_RUN_PURPOSES,
  AI_RUN_STATUSES,
  SAFE_FAILURE_CATEGORIES,
} from '@affiliate-content-os/domain';
import {
  extractOwnRowProperties,
  mapSafeTimestamp,
  validateAndCopy32ByteHash,
  validateBoundedString,
  validateEnum,
  validateOptionalBoundedString,
  validateSafeVersion,
  validateUuid,
} from '../catalog/mapper-helpers.js';
import { parseSafeBigIntNumber } from './job-policy-mappers.js';
import { validateSafeInteger } from './mapper-safety.js';

const AI_RUN_COLS = [
  'id',
  'workspace_id',
  'operation_id',
  'purpose',
  'provider',
  'model',
  'prompt_template',
  'prompt_version',
  'input_schema_version',
  'output_schema_version',
  'input_hash',
  'output_hash',
  'status',
  'attempt',
  'is_repair',
  'token_input',
  'token_output',
  'cost_microunits',
  'cost_currency',
  'latency_ms',
  'safety_result',
  'error_category',
  'requested_by_user_id',
  'started_at',
  'completed_at',
  'created_at',
  'updated_at',
  'version',
] as const;

export function mapAIRunRow(row: unknown): AIRunSnapshot {
  const v = extractOwnRowProperties(row, AI_RUN_COLS);
  const status = validateEnum<AIRunStatus>(v['status'], 'ai_runs.status', AI_RUN_STATUSES);
  const purpose = validateEnum<AIRunPurpose>(v['purpose'], 'ai_runs.purpose', AI_RUN_PURPOSES);

  let errorCategory: SafeFailureCategory | null = null;
  if (v['error_category'] !== null && v['error_category'] !== undefined) {
    errorCategory = validateEnum<SafeFailureCategory>(
      v['error_category'],
      'ai_runs.error_category',
      SAFE_FAILURE_CATEGORIES,
    );
  }

  let usage = null;
  if (v['token_input'] !== null && v['token_input'] !== undefined) {
    usage = Object.freeze({
      tokenInput: validateSafeInteger(v['token_input'], 'ai_runs.token_input', 0, 100_000_000),
      tokenOutput: validateSafeInteger(
        v['token_output'] ?? 0,
        'ai_runs.token_output',
        0,
        100_000_000,
      ),
      costMicrounits: parseSafeBigIntNumber(v['cost_microunits'] ?? 0, 'ai_runs.cost_microunits'),
      costCurrency: validateBoundedString(
        v['cost_currency'] ?? 'USD',
        'ai_runs.cost_currency',
        1,
        16,
      ),
      latencyMs: validateSafeInteger(v['latency_ms'] ?? 0, 'ai_runs.latency_ms', 0, 3_600_000),
    });
  }

  return Object.freeze({
    id: parseAIRunId(validateUuid(v['id'], 'ai_runs.id')),
    workspaceId: parseWorkspaceId(validateUuid(v['workspace_id'], 'ai_runs.workspace_id')),
    operationId: parseOperationId(validateUuid(v['operation_id'], 'ai_runs.operation_id')),
    purpose,
    provider: validateBoundedString(v['provider'], 'ai_runs.provider', 1, 128),
    model: validateBoundedString(v['model'], 'ai_runs.model', 1, 128),
    promptTemplate: validateBoundedString(v['prompt_template'], 'ai_runs.prompt_template', 1, 128),
    promptVersion: validateBoundedString(v['prompt_version'], 'ai_runs.prompt_version', 1, 64),
    inputSchemaVersion: validateSafeInteger(
      v['input_schema_version'],
      'ai_runs.input_schema_version',
      1,
    ),
    outputSchemaVersion: validateSafeInteger(
      v['output_schema_version'],
      'ai_runs.output_schema_version',
      1,
    ),
    inputHash: validateAndCopy32ByteHash(v['input_hash'], 'ai_runs.input_hash'),
    outputHash: v['output_hash']
      ? validateAndCopy32ByteHash(v['output_hash'], 'ai_runs.output_hash')
      : null,
    status,
    attempt: validateSafeInteger(v['attempt'] ?? 1, 'ai_runs.attempt', 1, 1000),
    isRepair: Boolean(v['is_repair']),
    usage,
    safetyResult: validateOptionalBoundedString(
      v['safety_result'],
      'ai_runs.safety_result',
      256,
      false,
    ),
    errorCategory,
    requestedByUserId: parseUserId(
      validateUuid(v['requested_by_user_id'], 'ai_runs.requested_by_user_id'),
    ),
    startedAt: v['started_at'] ? mapSafeTimestamp(v['started_at'], 'ai_runs.started_at') : null,
    completedAt: v['completed_at']
      ? mapSafeTimestamp(v['completed_at'], 'ai_runs.completed_at')
      : null,
    createdAt: mapSafeTimestamp(v['created_at'], 'ai_runs.created_at'),
    updatedAt: mapSafeTimestamp(v['updated_at'], 'ai_runs.updated_at'),
    version: validateSafeVersion(v['version'], 'ai_runs.version'),
  });
}
