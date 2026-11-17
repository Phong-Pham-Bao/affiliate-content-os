import { isPlainObject, ApiError } from './api-validators-common.js';
import type {
  ComplianceEvaluationDTO,
  ComplianceFindingDTO,
  ComplianceSeverity,
  ComplianceSource,
  ComplianceEvaluationStatus,
  ContentApprovalSnapshotDTO,
  ContentReviewDecisionDTO,
  ReviewDecisionKind,
} from '../types/compliance.js';
import type { ContentArtifactDetailDTO } from '../types/workforce.js';
import { validateContentArtifactDetail } from './workforce-validators-artifact.js';

function invalid(msg: string): never {
  throw new ApiError(500, {
    status: 500,
    title: 'Validation Error',
    detail: msg,
  });
}

export function validateComplianceFinding(val: unknown): ComplianceFindingDTO {
  if (!isPlainObject(val)) invalid('Compliance finding must be an object');
  const rawEv = Array.isArray(val.evidenceReferences) ? val.evidenceReferences : [];
  return {
    id: String(val.id),
    workspaceId: String(val.workspaceId),
    evaluationId: String(val.evaluationId),
    ruleId: String(val.ruleId),
    severity: (val.severity as ComplianceSeverity) || 'info',
    source: (val.source as ComplianceSource) || 'deterministic_rule',
    fingerprintHex: String(val.fingerprintHex ?? ''),
    videoNumber:
      val.videoNumber !== null && val.videoNumber !== undefined ? Number(val.videoNumber) : null,
    fieldPath: val.fieldPath !== null && val.fieldPath !== undefined ? String(val.fieldPath) : null,
    flaggedText:
      val.flaggedText !== null && val.flaggedText !== undefined ? String(val.flaggedText) : null,
    message: String(val.message ?? ''),
    suggestedFix:
      val.suggestedFix !== null && val.suggestedFix !== undefined ? String(val.suggestedFix) : null,
    evidenceReferences: rawEv.map((e) => {
      if (!isPlainObject(e)) invalid('Evidence reference must be an object');
      return {
        sourceKind: (e.sourceKind as 'product_fact' | 'analysis') || 'product_fact',
        sourceId: String(e.sourceId),
      };
    }),
    createdAt: String(val.createdAt ?? ''),
  };
}

export function validateComplianceEvaluation(val: unknown): ComplianceEvaluationDTO {
  if (!isPlainObject(val)) invalid('Compliance evaluation must be an object');
  const rawFindings = Array.isArray(val.findings) ? val.findings : [];
  return {
    id: String(val.id),
    workspaceId: String(val.workspaceId),
    artifactId: String(val.artifactId),
    revisionNumber: Number(val.revisionNumber ?? 1),
    contentHashHex: String(val.contentHashHex ?? ''),
    policyVersion: String(val.policyVersion ?? ''),
    policyHashHex: String(val.policyHashHex ?? ''),
    status: (val.status as ComplianceEvaluationStatus) || 'pending',
    blockingCount: Number(val.blockingCount ?? 0),
    warningCount: Number(val.warningCount ?? 0),
    infoCount: Number(val.infoCount ?? 0),
    evaluatedAt: String(val.evaluatedAt ?? ''),
    evaluatedByActorType: (val.evaluatedByActorType as 'system' | 'user') || 'system',
    evaluatedByActorId: String(val.evaluatedByActorId ?? ''),
    operationId:
      val.operationId !== null && val.operationId !== undefined ? String(val.operationId) : null,
    failureReason:
      val.failureReason !== null && val.failureReason !== undefined
        ? String(val.failureReason)
        : null,
    findings: rawFindings.map(validateComplianceFinding),
  };
}

export function validateReviewDecision(val: unknown): ContentReviewDecisionDTO {
  if (!isPlainObject(val)) invalid('Content review decision must be an object');
  return {
    id: String(val.id),
    workspaceId: String(val.workspaceId),
    artifactId: String(val.artifactId),
    revisionNumber: Number(val.revisionNumber ?? 1),
    contentHashHex: String(val.contentHashHex ?? ''),
    actorUserId: String(val.actorUserId ?? ''),
    decision: (val.decision as ReviewDecisionKind) || 'accepted',
    reason: val.reason !== null && val.reason !== undefined ? String(val.reason) : null,
    note: val.note !== null && val.note !== undefined ? String(val.note) : null,
    complianceEvaluationId:
      val.complianceEvaluationId !== null && val.complianceEvaluationId !== undefined
        ? String(val.complianceEvaluationId)
        : null,
    createdAt: String(val.createdAt ?? ''),
  };
}

export function validateReviewDecisionList(val: unknown): {
  readonly items: readonly ContentReviewDecisionDTO[];
} {
  if (!isPlainObject(val)) invalid('Review decision list response must be an object');
  const rawItems = Array.isArray(val.items) ? val.items : [];
  return { items: rawItems.map(validateReviewDecision) };
}

export function validateApprovalSnapshot(val: unknown): ContentApprovalSnapshotDTO {
  if (!isPlainObject(val)) invalid('Content approval snapshot must be an object');
  return {
    id: String(val.id),
    workspaceId: String(val.workspaceId),
    artifactId: String(val.artifactId),
    revisionNumber: Number(val.revisionNumber ?? 1),
    contentHashHex: String(val.contentHashHex ?? ''),
    approvedByUserId: String(val.approvedByUserId ?? ''),
    complianceEvaluationId: String(val.complianceEvaluationId ?? ''),
    policyVersion: String(val.policyVersion ?? ''),
    policyHashHex: String(val.policyHashHex ?? ''),
    snapshotContentJson: isPlainObject(val.snapshotContentJson) ? val.snapshotContentJson : {},
    evidenceReferencesJson: Array.isArray(val.evidenceReferencesJson)
      ? val.evidenceReferencesJson
      : [],
    affiliateDisclosureText: String(val.affiliateDisclosureText ?? ''),
    createdAt: String(val.createdAt ?? ''),
  };
}

export function validateAcceptRevisionResult(val: unknown): {
  readonly artifact: ContentArtifactDetailDTO;
  readonly decision: ContentReviewDecisionDTO;
  readonly approvalSnapshot: ContentApprovalSnapshotDTO;
} {
  if (!isPlainObject(val)) invalid('Accept revision response must be an object');
  return {
    artifact: validateContentArtifactDetail(val.artifact),
    decision: validateReviewDecision(val.decision),
    approvalSnapshot: validateApprovalSnapshot(val.approvalSnapshot),
  };
}

export function validateRejectRevisionResult(val: unknown): {
  readonly artifact: ContentArtifactDetailDTO;
  readonly decision: ContentReviewDecisionDTO;
} {
  if (!isPlainObject(val)) invalid('Reject revision response must be an object');
  return {
    artifact: validateContentArtifactDetail(val.artifact),
    decision: validateReviewDecision(val.decision),
  };
}
