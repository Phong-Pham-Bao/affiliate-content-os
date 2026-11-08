import type {
  ArtifactEvidenceRefDTO,
  ContentArtifactRevisionDTO,
  ContentArtifactSummaryDTO,
  WorkOrderActivityDTO,
} from '@affiliate-content-os/application';
import {
  parseAgentAssignmentId,
  parseProductId,
  parseWorkItemId,
  parseWorkOrderId,
  parseWorkspaceId,
  type AgentRoleKey,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import {
  isProxySafe,
  mapSafeTimestamp,
  validateAndCopy32ByteHash,
  validateBoundedString,
  validateSafeVersion,
  validateUuid,
} from '../catalog/mapper-helpers.js';

function extractRowObject(row: unknown, context: string): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || isProxySafe(row)) {
    throw new DatabaseError(`Corrupt database row: invalid row structure for ${context}`);
  }
  const proto = Object.getPrototypeOf(row);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError(`Corrupt database row: invalid row prototype for ${context}`);
  }
  return row as Record<string, unknown>;
}

export function mapContentArtifactRowToSummaryDTO(row: unknown): ContentArtifactSummaryDTO {
  const v = extractRowObject(row, 'content_artifacts');
  return Object.freeze({
    id: validateUuid(v['id'], 'content_artifacts.id'),
    workspaceId: parseWorkspaceId(
      validateUuid(v['workspace_id'], 'content_artifacts.workspace_id'),
    ),
    productId: parseProductId(validateUuid(v['product_id'], 'content_artifacts.product_id')),
    workOrderId: parseWorkOrderId(
      validateUuid(v['work_order_id'], 'content_artifacts.work_order_id'),
    ),
    workItemId: parseWorkItemId(validateUuid(v['work_item_id'], 'content_artifacts.work_item_id')),
    assignmentId: parseAgentAssignmentId(
      validateUuid(
        v['assignment_id'] ?? v['author_assignment_id'],
        'content_artifacts.assignment_id',
      ),
    ),
    authorRoleKey: validateBoundedString(
      v['author_role_key'],
      'content_artifacts.author_role_key',
      1,
      64,
    ) as AgentRoleKey,
    artifactType: validateBoundedString(
      v['artifact_type'],
      'content_artifacts.artifact_type',
      1,
      64,
    ),
    lifecycleStatus: validateBoundedString(
      v['lifecycle_status'] ?? v['current_lifecycle_status'],
      'content_artifacts.lifecycle_status',
      1,
      32,
    ),
    currentRevisionNumber: Number(v['current_revision_number'] ?? v['revision_count'] ?? 1),
    createdAt: mapSafeTimestamp(v['created_at'], 'content_artifacts.created_at'),
    updatedAt: mapSafeTimestamp(v['updated_at'], 'content_artifacts.updated_at'),
    version: validateSafeVersion(v['version'], 'content_artifacts.version'),
  });
}

export function mapArtifactEvidenceRefRowToDTO(row: unknown): ArtifactEvidenceRefDTO {
  const v = extractRowObject(row, 'artifact_evidence_refs');
  const sourceKind = v['source_kind'] === 'product_fact' ? 'product_fact' : 'analysis';
  return Object.freeze({
    id: validateUuid(v['id'], 'artifact_evidence_refs.id'),
    sourceKind,
    sourceId: validateUuid(v['source_id'], 'artifact_evidence_refs.source_id'),
    createdAt: mapSafeTimestamp(v['created_at'], 'artifact_evidence_refs.created_at'),
  });
}

export function mapContentArtifactRevisionRowToDTO(row: unknown): ContentArtifactRevisionDTO {
  const v = extractRowObject(row, 'content_artifact_revisions');
  const hashBytes = validateAndCopy32ByteHash(
    v['content_hash'] ?? v['canonical_content_hash'],
    'content_artifact_revisions.content_hash',
  );
  const contentHashHex = Buffer.from(hashBytes).toString('hex');

  return Object.freeze({
    id: validateUuid(v['id'], 'content_artifact_revisions.id'),
    workspaceId: parseWorkspaceId(
      validateUuid(v['workspace_id'], 'content_artifact_revisions.workspace_id'),
    ),
    artifactId: validateUuid(v['artifact_id'], 'content_artifact_revisions.artifact_id'),
    revisionNumber: Number(v['revision_number']),
    contentJson: (v['content_json'] ?? {}) as Record<string, unknown>,
    contentHashHex,
    schemaVersion: Number(v['schema_version'] ?? 1),
    promptTemplate: validateBoundedString(v['prompt_template'], 'prompt_template', 1, 64),
    promptVersion: validateBoundedString(v['prompt_version'], 'prompt_version', 1, 32),
    provider: validateBoundedString(v['provider'], 'provider', 1, 32),
    model: validateBoundedString(v['model'], 'model', 1, 64),
    tokenInput:
      v['token_input'] !== null && v['token_input'] !== undefined ? Number(v['token_input']) : null,
    tokenOutput:
      v['token_output'] !== null && v['token_output'] !== undefined
        ? Number(v['token_output'])
        : null,
    costMicrounits:
      v['cost_microunits'] !== null && v['cost_microunits'] !== undefined
        ? Number(v['cost_microunits'])
        : null,
    costCurrency: v['cost_currency'] ? String(v['cost_currency']) : null,
    latencyMs:
      v['latency_ms'] !== null && v['latency_ms'] !== undefined ? Number(v['latency_ms']) : null,
    authorRoleKey: validateBoundedString(
      v['author_role_key'],
      'author_role_key',
      1,
      64,
    ) as AgentRoleKey,
    createdAt: mapSafeTimestamp(v['created_at'], 'content_artifact_revisions.created_at'),
  });
}

export function mapWorkOrderActivityRowToDTO(row: unknown): WorkOrderActivityDTO {
  const v = extractRowObject(row, 'audit_events');
  return Object.freeze({
    id: validateUuid(v['id'], 'audit_events.id'),
    action: validateBoundedString(v['action'], 'audit_events.action', 1, 64),
    resourceType: validateBoundedString(v['resource_type'], 'audit_events.resource_type', 1, 64),
    resourceId: validateUuid(v['resource_id'], 'audit_events.resource_id'),
    result: validateBoundedString(v['result'], 'audit_events.result', 1, 32),
    occurredAt: mapSafeTimestamp(v['created_at'] ?? v['occurred_at'], 'audit_events.created_at'),
    changesJson: (v['changes_json'] ?? {}) as Record<string, unknown>,
  });
}
