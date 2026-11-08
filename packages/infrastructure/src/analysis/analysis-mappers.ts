import {
  parseAIRunId,
  parseAnalysisId,
  parseOperationId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type AnalysisSnapshot,
  type AnalysisStatus,
  type AnalysisType,
  type OperationSnapshot,
  type OperationStatus,
  type OperationType,
  type SafeFailureCategory,
  ANALYSIS_STATUSES,
  ANALYSIS_TYPES,
  OPERATION_STATUSES,
  OPERATION_TYPES,
  SAFE_FAILURE_CATEGORIES,
} from '@affiliate-content-os/domain';
import {
  extractOwnRowProperties,
  mapSafeTimestamp,
  validateEnum,
  validateOptionalBoundedString,
  validateSafeVersion,
  validateUuid,
} from '../catalog/mapper-helpers.js';
import { deepFreeze, validateOptionalSafeInteger, validateSafeInteger } from './mapper-safety.js';

export {
  mapJobExecutionRow,
  mapWorkspaceAIPolicyRow,
  parseSafeBigIntNumber,
} from './job-policy-mappers.js';
export { mapAIRunRow } from './ai-run-mapper.js';

const OPERATION_COLS = [
  'id',
  'workspace_id',
  'operation_type',
  'resource_type',
  'resource_id',
  'status',
  'progress_percent',
  'result_location',
  'error_category',
  'error_code',
  'error_message',
  'requested_by_user_id',
  'started_at',
  'completed_at',
  'created_at',
  'updated_at',
  'version',
  'work_order_id',
  'work_item_id',
] as const;

export function mapOperationRow(row: unknown): OperationSnapshot {
  const v = extractOwnRowProperties(row, OPERATION_COLS);
  const status = validateEnum<OperationStatus>(
    v['status'],
    'operations.status',
    OPERATION_STATUSES,
  );
  const operationType = validateEnum<OperationType>(
    v['operation_type'],
    'operations.operation_type',
    OPERATION_TYPES,
  );

  let errorCategory: SafeFailureCategory | null = null;
  if (v['error_category'] !== null && v['error_category'] !== undefined) {
    errorCategory = validateEnum<SafeFailureCategory>(
      v['error_category'],
      'operations.error_category',
      SAFE_FAILURE_CATEGORIES,
    );
  }

  return Object.freeze({
    id: parseOperationId(validateUuid(v['id'], 'operations.id')),
    workspaceId: parseWorkspaceId(validateUuid(v['workspace_id'], 'operations.workspace_id')),
    operationType,
    resourceType: 'product',
    resourceId: parseProductId(validateUuid(v['resource_id'], 'operations.resource_id')),
    status,
    progressPercent: validateOptionalSafeInteger(
      v['progress_percent'],
      'operations.progress_percent',
      0,
      100,
    ),
    resultLocation: validateOptionalBoundedString(
      v['result_location'],
      'operations.result_location',
      2048,
      false,
    ),
    errorCategory,
    errorCode: validateOptionalBoundedString(v['error_code'], 'operations.error_code', 128, false),
    errorMessage: validateOptionalBoundedString(
      v['error_message'],
      'operations.error_message',
      2048,
      true,
    ),
    requestedByUserId: parseUserId(
      validateUuid(v['requested_by_user_id'], 'operations.requested_by_user_id'),
    ),
    startedAt: v['started_at'] ? mapSafeTimestamp(v['started_at'], 'operations.started_at') : null,
    completedAt: v['completed_at']
      ? mapSafeTimestamp(v['completed_at'], 'operations.completed_at')
      : null,
    createdAt: mapSafeTimestamp(v['created_at'], 'operations.created_at'),
    updatedAt: mapSafeTimestamp(v['updated_at'], 'operations.updated_at'),
    version: validateSafeVersion(v['version'], 'operations.version'),
  });
}

const ANALYSIS_COLS = [
  'id',
  'workspace_id',
  'product_id',
  'analysis_type',
  'revision_number',
  'fact_set_id',
  'ai_run_id',
  'content_json',
  'schema_version',
  'status',
  'reviewed_by_user_id',
  'reviewed_at',
  'review_reason',
  'created_by_user_id',
  'created_at',
  'updated_at',
  'version',
] as const;

export function mapAnalysisRow(row: unknown): AnalysisSnapshot {
  const v = extractOwnRowProperties(row, ANALYSIS_COLS);
  const status = validateEnum<AnalysisStatus>(v['status'], 'analyses.status', ANALYSIS_STATUSES);
  const analysisType = validateEnum<AnalysisType>(
    v['analysis_type'],
    'analyses.analysis_type',
    ANALYSIS_TYPES,
  );

  const content =
    typeof v['content_json'] === 'string' ? JSON.parse(v['content_json']) : v['content_json'];

  return Object.freeze({
    id: parseAnalysisId(validateUuid(v['id'], 'analyses.id')),
    workspaceId: parseWorkspaceId(validateUuid(v['workspace_id'], 'analyses.workspace_id')),
    productId: parseProductId(validateUuid(v['product_id'], 'analyses.product_id')),
    analysisType,
    revisionNumber: validateSafeInteger(v['revision_number'], 'analyses.revision_number', 1),
    factSetId: parseProductFactSetId(validateUuid(v['fact_set_id'], 'analyses.fact_set_id')),
    aiRunId: parseAIRunId(validateUuid(v['ai_run_id'], 'analyses.ai_run_id')),
    contentJson: deepFreeze(content),
    schemaVersion: validateSafeInteger(v['schema_version'], 'analyses.schema_version', 1),
    status,
    reviewedByUserId: v['reviewed_by_user_id']
      ? parseUserId(validateUuid(v['reviewed_by_user_id'], 'analyses.reviewed_by_user_id'))
      : null,
    reviewedAt: v['reviewed_at']
      ? mapSafeTimestamp(v['reviewed_at'], 'analyses.reviewed_at')
      : null,
    reviewReason: validateOptionalBoundedString(
      v['review_reason'],
      'analyses.review_reason',
      2048,
      true,
    ),
    createdByUserId: parseUserId(
      validateUuid(v['created_by_user_id'], 'analyses.created_by_user_id'),
    ),
    createdAt: mapSafeTimestamp(v['created_at'], 'analyses.created_at'),
    updatedAt: mapSafeTimestamp(v['updated_at'], 'analyses.updated_at'),
    version: validateSafeVersion(v['version'], 'analyses.version'),
  });
}
