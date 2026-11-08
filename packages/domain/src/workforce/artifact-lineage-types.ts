import type { UserId, WorkspaceId } from '../ids.js';
import type { ContentArtifactId } from './artifact-ids.js';

export const ARTIFACT_LINEAGE_TYPES = ['ai_generated', 'human_edited', 'change_request'] as const;

export type ArtifactLineageType = (typeof ARTIFACT_LINEAGE_TYPES)[number];

export interface ArtifactLineageRecord {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly artifactId: ContentArtifactId;
  readonly revisionNumber: number;
  readonly parentRevisionNumber: number | null;
  readonly lineageType: ArtifactLineageType;
  readonly changeRequestId: string | null;
  readonly contentBriefHash: Uint8Array;
  readonly contentBriefVersion: number;
  readonly planningRevisionIds: Record<string, unknown>;
  readonly sourceScriptUnitIds: readonly string[];
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export const ARTIFACT_CHANGE_REQUEST_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'canceled',
] as const;

export type ArtifactChangeRequestStatus = (typeof ARTIFACT_CHANGE_REQUEST_STATUSES)[number];

export interface ArtifactChangeRequest {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly artifactId: ContentArtifactId;
  readonly baseRevisionNumber: number;
  readonly baseContentHash: Uint8Array;
  readonly requestedByUserId: UserId;
  readonly instructionText: string;
  readonly selectedVideoNumbers: readonly (1 | 2 | 3 | 4 | 5)[];
  readonly targetVariantCount: number;
  readonly status: ArtifactChangeRequestStatus;
  readonly resultingRevisionNumber: number | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}
