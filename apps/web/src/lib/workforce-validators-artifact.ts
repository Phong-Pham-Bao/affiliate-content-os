import { isPlainObject, ApiError } from './api-validators-common.js';
import type {
  AgentRoleKey,
  ArtifactEvidenceRefDTO,
  ContentArtifactDetailDTO,
  ContentArtifactRevisionDTO,
  ContentArtifactSummaryDTO,
  ContentArtifactType,
  WorkOrderActivityDTO,
} from '../types/workforce.js';

function invalid(msg: string): never {
  throw new ApiError(500, {
    status: 500,
    title: 'Validation Error',
    detail: msg,
  });
}

export function validateContentArtifactSummary(val: unknown): ContentArtifactSummaryDTO {
  if (!isPlainObject(val)) invalid('Artifact summary must be an object');
  return {
    id: String(val.id),
    workspaceId: String(val.workspaceId),
    productId: String(val.productId),
    workOrderId: String(val.workOrderId),
    workItemId: String(val.workItemId),
    assignmentId: String(val.assignmentId),
    authorRoleKey: val.authorRoleKey as AgentRoleKey,
    artifactType: val.artifactType as ContentArtifactType,
    lifecycleStatus: String(val.lifecycleStatus ?? 'draft'),
    currentRevisionNumber: Number(val.currentRevisionNumber ?? 1),
    createdAt: String(val.createdAt ?? ''),
    updatedAt: String(val.updatedAt ?? ''),
    version: Number(val.version ?? 1),
  };
}

export function validateContentArtifactRevision(val: unknown): ContentArtifactRevisionDTO {
  if (!isPlainObject(val)) invalid('Artifact revision must be an object');
  return {
    id: String(val.id),
    workspaceId: String(val.workspaceId),
    artifactId: String(val.artifactId),
    revisionNumber: Number(val.revisionNumber ?? 1),
    contentJson: isPlainObject(val.contentJson) ? val.contentJson : {},
    contentHashHex: String(val.contentHashHex ?? ''),
    schemaVersion: Number(val.schemaVersion ?? 1),
    promptTemplate: String(val.promptTemplate ?? ''),
    promptVersion: String(val.promptVersion ?? ''),
    provider: String(val.provider ?? ''),
    model: String(val.model ?? ''),
    tokenInput:
      val.tokenInput !== null && val.tokenInput !== undefined ? Number(val.tokenInput) : null,
    tokenOutput:
      val.tokenOutput !== null && val.tokenOutput !== undefined ? Number(val.tokenOutput) : null,
    costMicrounits:
      val.costMicrounits !== null && val.costMicrounits !== undefined
        ? Number(val.costMicrounits)
        : null,
    costCurrency: val.costCurrency ? String(val.costCurrency) : null,
    latencyMs: val.latencyMs !== null && val.latencyMs !== undefined ? Number(val.latencyMs) : null,
    authorRoleKey: val.authorRoleKey as AgentRoleKey,
    createdAt: String(val.createdAt ?? ''),
  };
}

export function validateArtifactEvidenceRef(val: unknown): ArtifactEvidenceRefDTO {
  if (!isPlainObject(val)) invalid('Artifact evidence ref must be an object');
  return {
    id: String(val.id),
    sourceKind: (val.sourceKind as 'product_fact' | 'analysis') ?? 'product_fact',
    sourceId: String(val.sourceId),
    createdAt: String(val.createdAt ?? ''),
  };
}

export function validateContentArtifactDetail(val: unknown): ContentArtifactDetailDTO {
  if (!isPlainObject(val)) invalid('Artifact detail must be an object');
  const artifact = validateContentArtifactSummary(val.artifact);
  const latestRevision = validateContentArtifactRevision(val.latestRevision);
  const evidenceReferences: ArtifactEvidenceRefDTO[] = Array.isArray(val.evidenceReferences)
    ? val.evidenceReferences.map(validateArtifactEvidenceRef)
    : [];
  return { artifact, latestRevision, evidenceReferences };
}

export function validateContentArtifactList(val: unknown): {
  readonly items: readonly ContentArtifactSummaryDTO[];
} {
  if (!isPlainObject(val)) invalid('Artifact list response must be an object');
  const rawItems = Array.isArray(val.items) ? val.items : [];
  return { items: rawItems.map(validateContentArtifactSummary) };
}

export function validateWorkOrderActivityList(val: unknown): {
  readonly items: readonly WorkOrderActivityDTO[];
} {
  if (!isPlainObject(val)) invalid('Activity list response must be an object');
  const rawItems = Array.isArray(val.items) ? val.items : [];
  return {
    items: rawItems.map((item: unknown) => {
      const obj = isPlainObject(item) ? item : {};
      return {
        id: String(obj.id ?? ''),
        action: String(obj.action ?? ''),
        resourceType: String(obj.resourceType ?? ''),
        resourceId: String(obj.resourceId ?? ''),
        result: String(obj.result ?? ''),
        occurredAt: String(obj.occurredAt ?? ''),
        changesJson: isPlainObject(obj.changesJson) ? obj.changesJson : {},
      };
    }),
  };
}
