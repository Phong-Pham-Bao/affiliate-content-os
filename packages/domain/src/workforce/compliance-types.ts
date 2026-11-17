import type { ProductId } from '../catalog/ids.js';
import type { WorkspaceId } from '../ids.js';
import type { WorkOrderId } from './ids.js';
import type { ContentArtifactId } from './artifact-ids.js';

export const COMPLIANCE_SEVERITIES = ['info', 'warning', 'blocking'] as const;
export type ComplianceSeverity = (typeof COMPLIANCE_SEVERITIES)[number];

export const COMPLIANCE_SOURCES = ['deterministic', 'ai_advisory'] as const;
export type ComplianceSource = (typeof COMPLIANCE_SOURCES)[number];

export const COMPLIANCE_EVALUATION_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type ComplianceEvaluationStatus = (typeof COMPLIANCE_EVALUATION_STATUSES)[number];

export const COMPLIANCE_EVALUATION_RESULTS = [
  'pending',
  'passed',
  'warning',
  'blocked',
  'failed',
] as const;
export type ComplianceEvaluationResult = (typeof COMPLIANCE_EVALUATION_RESULTS)[number];

export const COMPLIANCE_ADVISORY_STATUSES = ['skipped', 'pending', 'completed', 'failed'] as const;
export type ComplianceAdvisoryStatus = (typeof COMPLIANCE_ADVISORY_STATUSES)[number];

export const CONTENT_REVIEW_DECISION_TYPES = ['accept', 'reject', 'request_changes'] as const;
export type ContentReviewDecisionType = (typeof CONTENT_REVIEW_DECISION_TYPES)[number];

export interface ComplianceFinding {
  readonly fingerprint: string;
  readonly code: string;
  readonly severity: ComplianceSeverity;
  readonly source: ComplianceSource;
  readonly videoNumber: number | null;
  readonly fieldPath: string;
  readonly message: string;
  readonly evidenceIds: readonly string[];
}

export interface ComplianceEvaluationSnapshot {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly workOrderId: WorkOrderId;
  readonly artifactId: ContentArtifactId;
  readonly revisionNumber: number;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly status: ComplianceEvaluationStatus;
  readonly result: ComplianceEvaluationResult;
  readonly blockingCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly deterministicPassed: boolean;
  readonly aiAdvisoryStatus: ComplianceAdvisoryStatus;
  readonly evaluationReportArtifactId: string | null;
  readonly aiRunId: string | null;
  readonly jobId: string | null;
  readonly operationId: string | null;
  readonly findings: readonly ComplianceFinding[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ContentReviewDecisionSnapshot {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly artifactId: ContentArtifactId;
  readonly revisionNumber: number;
  readonly contentHash: string;
  readonly evaluationId: string | null;
  readonly decision: ContentReviewDecisionType;
  readonly actorUserId: string;
  readonly reason: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface ContentApprovalSnapshot {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly artifactId: ContentArtifactId;
  readonly revisionNumber: number;
  readonly contentHash: string;
  readonly evaluationId: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly decisionId: string;
  readonly approvedByUserId: string;
  readonly evidenceIds: readonly string[];
  readonly disclosureState: Record<string, unknown>;
  readonly snapshot: Record<string, unknown>;
  readonly snapshotHash: string;
  readonly createdAt: string;
}

export interface ComplianceReportContent {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly scriptArtifactId: string;
  readonly scriptRevisionNumber: number;
  readonly scriptContentHash: string;
  readonly result: ComplianceEvaluationResult;
  readonly blockingCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly deterministicPassed: boolean;
  readonly aiAdvisoryStatus: ComplianceAdvisoryStatus;
  readonly findings: readonly ComplianceFinding[];
  readonly summary: string;
  readonly evaluatedAt: string;
}
