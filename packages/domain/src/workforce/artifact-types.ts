import type { ProductId } from '../catalog/ids.js';
import type { WorkspaceId } from '../ids.js';
import type { AgentAssignmentId, WorkItemId, WorkOrderId } from './ids.js';
import type {
  ArtifactEvidenceRefId,
  ContentArtifactId,
  ContentArtifactRevisionId,
} from './artifact-ids.js';
import type { AgentRoleKey } from './role-types.js';

export const CONTENT_ARTIFACT_TYPES = [
  'product_campaign_plan',
  'audience_insight_board',
  'video_series_plan',
  'script_package',
  'compliance_report',
  'work_plan',
  'executive_summary',
  'video_idea',
  'script',
  'shot_list',
  'caption_variant',
] as const;

export type ContentArtifactType = (typeof CONTENT_ARTIFACT_TYPES)[number];

export const PLANNING_ARTIFACT_TYPES = [
  'product_campaign_plan',
  'audience_insight_board',
  'video_series_plan',
] as const;

export type PlanningArtifactType = (typeof PLANNING_ARTIFACT_TYPES)[number];

export const CONTENT_ARTIFACT_LIFECYCLE_STATUSES = [
  'draft',
  'review_required',
  'accepted',
  'rejected',
  'superseded',
] as const;

export type ContentArtifactLifecycleStatus = (typeof CONTENT_ARTIFACT_LIFECYCLE_STATUSES)[number];

export type ArtifactEvidenceSourceKind = 'product_fact' | 'analysis';

export interface ArtifactEvidenceRefSnapshot {
  readonly id: ArtifactEvidenceRefId;
  readonly workspaceId: WorkspaceId;
  readonly artifactId: ContentArtifactId;
  readonly revisionNumber: number;
  readonly sourceKind: ArtifactEvidenceSourceKind;
  readonly sourceId: string;
  readonly createdAt: string;
}

export interface ContentArtifactSnapshot {
  readonly id: ContentArtifactId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly workOrderId: WorkOrderId;
  readonly workItemId: WorkItemId;
  readonly assignmentId: AgentAssignmentId;
  readonly authorRoleKey: AgentRoleKey;
  readonly artifactType: ContentArtifactType;
  readonly lifecycleStatus: ContentArtifactLifecycleStatus;
  readonly currentRevisionNumber: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ContentArtifactRevisionSnapshot {
  readonly id: ContentArtifactRevisionId;
  readonly workspaceId: WorkspaceId;
  readonly artifactId: ContentArtifactId;
  readonly revisionNumber: number;
  readonly contentJson: Record<string, unknown>;
  readonly contentHash: Uint8Array;
  readonly schemaVersion: number;
  readonly promptTemplate: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly tokenInput: number | null;
  readonly tokenOutput: number | null;
  readonly costMicrounits: number | null;
  readonly costCurrency: string | null;
  readonly latencyMs: number | null;
  readonly authorRoleKey: AgentRoleKey;
  readonly createdAt: string;
}

export function isContentArtifactType(value: unknown): value is ContentArtifactType {
  return typeof value === 'string' && CONTENT_ARTIFACT_TYPES.includes(value as ContentArtifactType);
}

export function isPlanningArtifactType(value: unknown): value is PlanningArtifactType {
  return (
    typeof value === 'string' && PLANNING_ARTIFACT_TYPES.includes(value as PlanningArtifactType)
  );
}

export function isContentArtifactLifecycleStatus(
  value: unknown,
): value is ContentArtifactLifecycleStatus {
  return (
    typeof value === 'string' &&
    CONTENT_ARTIFACT_LIFECYCLE_STATUSES.includes(value as ContentArtifactLifecycleStatus)
  );
}
