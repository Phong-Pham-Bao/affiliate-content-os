export type ComplianceSeverity = 'blocking' | 'warning' | 'info';

export type ComplianceSource = 'deterministic_rule' | 'ai_advisory';

export type ComplianceEvaluationStatus = 'pending' | 'running' | 'completed' | 'failed';

export type ReviewDecisionKind = 'accepted' | 'rejected' | 'requested_changes';

export interface ComplianceEvidenceReferenceDTO {
  readonly sourceKind: 'product_fact' | 'analysis';
  readonly sourceId: string;
}

export interface ComplianceFindingDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly evaluationId: string;
  readonly ruleId: string;
  readonly severity: ComplianceSeverity;
  readonly source: ComplianceSource;
  readonly fingerprintHex: string;
  readonly videoNumber?: number | null | undefined;
  readonly fieldPath?: string | null | undefined;
  readonly flaggedText?: string | null | undefined;
  readonly message: string;
  readonly suggestedFix?: string | null | undefined;
  readonly evidenceReferences: readonly ComplianceEvidenceReferenceDTO[];
  readonly createdAt: string;
}

export interface ComplianceEvaluationDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly scriptContentHashHex?: string | undefined;
  readonly policyVersion: string;
  readonly policyHashHex: string;
  readonly status: ComplianceEvaluationStatus;
  readonly result?: 'pending' | 'passed' | 'warning' | 'blocked' | 'failed' | undefined;
  readonly aiAdvisoryStatus?: 'skipped' | 'pending' | 'completed' | 'failed' | undefined;
  readonly evaluationReportArtifactId?: string | null | undefined;
  readonly evaluationReportRevisionNumber?: number | null | undefined;
  readonly evaluationReportContentHashHex?: string | null | undefined;
  readonly blockingCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly evaluatedAt: string;
  readonly evaluatedByActorType: 'system' | 'user';
  readonly evaluatedByActorId: string;
  readonly operationId?: string | null | undefined;
  readonly failureReason?: string | null | undefined;
  readonly findings: readonly ComplianceFindingDTO[];
}

export interface ContentReviewDecisionDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly actorUserId: string;
  readonly decision: ReviewDecisionKind;
  readonly reason?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly complianceEvaluationId?: string | null | undefined;
  readonly createdAt: string;
}

export interface ContentApprovalSnapshotDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly approvedByUserId: string;
  readonly complianceEvaluationId: string;
  readonly policyVersion: string;
  readonly policyHashHex: string;
  readonly snapshotContentJson: Record<string, unknown>;
  readonly evidenceReferencesJson: readonly unknown[];
  readonly affiliateDisclosureText: string;
  readonly createdAt: string;
}
