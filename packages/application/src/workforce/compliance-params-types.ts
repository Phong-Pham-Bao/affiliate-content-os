import type { UserId, WorkspaceId } from '@affiliate-content-os/domain';
import type {
  ComplianceEvaluationDTO,
  ContentApprovalSnapshotDTO,
  ContentArtifactDetailDTO,
  ContentReviewDecisionDTO,
} from './workforce-dtos.js';
import type { WorkforceIdempotencyParams } from './script-params-types.js';

export interface AcceptScriptRevisionParams {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly actorUserId: UserId;
  readonly expectedVersion: number;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly note?: string | undefined;
  readonly idempotency: WorkforceIdempotencyParams;
}

export interface AcceptScriptRevisionResult {
  readonly artifact: ContentArtifactDetailDTO;
  readonly decision: ContentReviewDecisionDTO;
  readonly approvalSnapshot: ContentApprovalSnapshotDTO;
}

export interface RejectScriptRevisionParams {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly actorUserId: UserId;
  readonly expectedVersion: number;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly reason: string;
  readonly idempotency: WorkforceIdempotencyParams;
}

export interface RejectScriptRevisionResult {
  readonly artifact: ContentArtifactDetailDTO;
  readonly decision: ContentReviewDecisionDTO;
}

export interface EnqueueComplianceEvaluationParams {
  readonly workspaceId: WorkspaceId;
  readonly productId: string;
  readonly workOrderId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly actorUserId: string;
  readonly policyVersion?: string | undefined;
  readonly expectedContentHashHex?: string | undefined;
}

export interface EnqueueComplianceEvaluationResult {
  readonly evaluation: ComplianceEvaluationDTO;
  readonly jobId: string;
  readonly operationId: string;
}
