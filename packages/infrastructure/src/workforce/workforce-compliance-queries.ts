import type pg from 'pg';
import type {
  ComplianceEvaluationDTO,
  ComplianceFindingDTO,
  ContentApprovalSnapshotDTO,
  ContentReviewDecisionDTO,
} from '@affiliate-content-os/application';
import { parseIsoTimestamp } from '@affiliate-content-os/domain';

export async function queryComplianceEvaluation(
  client: pg.Pool | pg.PoolClient,
  workspaceId: string,
  artifactId: string,
  revisionNumber?: number | undefined,
): Promise<ComplianceEvaluationDTO | null> {
  let query: string;
  let params: unknown[];

  if (revisionNumber !== undefined) {
    query = `
      SELECT id, workspace_id, product_id, work_order_id, context_package_id, artifact_id, revision_number,
             script_content_hash, policy_version, policy_hash, status, result, blocking_count, warning_count,
             info_count, deterministic_passed, ai_advisory_status, evaluation_report_artifact_id,
             evaluation_report_revision_number, evaluation_report_content_hash,
             created_at, updated_at, version
      FROM compliance_evaluations
      WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3
      ORDER BY created_at DESC
      LIMIT 1
    `;
    params = [workspaceId, artifactId, revisionNumber];
  } else {
    // Current revision
    query = `
      SELECT ce.id, ce.workspace_id, ce.product_id, ce.work_order_id, ce.context_package_id, ce.artifact_id, ce.revision_number,
             ce.script_content_hash, ce.policy_version, ce.policy_hash, ce.status, ce.result, ce.blocking_count, ce.warning_count,
             ce.info_count, ce.deterministic_passed, ce.ai_advisory_status, ce.evaluation_report_artifact_id,
             ce.evaluation_report_revision_number, ce.evaluation_report_content_hash,
             ce.created_at, ce.updated_at, ce.version
      FROM compliance_evaluations ce
      JOIN content_artifacts ca ON ca.id = ce.artifact_id AND ca.workspace_id = ce.workspace_id
      WHERE ce.workspace_id = $1 AND ce.artifact_id = $2 AND ce.revision_number = ca.current_revision_number
      ORDER BY ce.created_at DESC
      LIMIT 1
    `;
    params = [workspaceId, artifactId];
  }

  const evalRes = await client.query(query, params);
  if (evalRes.rowCount === 0 || !evalRes.rows[0]) {
    return null;
  }
  const row = evalRes.rows[0];

  const findingsRes = await client.query(
    `SELECT fingerprint, code, severity, source, video_number, field_path, message, evidence_ids_json
     FROM compliance_findings
     WHERE workspace_id = $1 AND evaluation_id = $2
     ORDER BY severity = 'blocking' DESC, severity = 'warning' DESC, video_number ASC NULLS FIRST, code ASC`,
    [workspaceId, row.id],
  );

  const findings: ComplianceFindingDTO[] = findingsRes.rows.map((f) => ({
    fingerprint: Buffer.from(f.fingerprint).toString('hex'),
    code: f.code,
    severity: f.severity,
    source: f.source,
    videoNumber: f.video_number !== null ? Number(f.video_number) : null,
    fieldPath: f.field_path,
    message: f.message,
    evidenceIds: Array.isArray(f.evidence_ids_json) ? f.evidence_ids_json : [],
  }));

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    productId: row.product_id,
    workOrderId: row.work_order_id,
    contextPackageId: row.context_package_id,
    artifactId: row.artifact_id,
    revisionNumber: Number(row.revision_number),
    scriptContentHashHex: Buffer.from(row.script_content_hash).toString('hex'),
    policyVersion: row.policy_version,
    policyHashHex: Buffer.from(row.policy_hash).toString('hex'),
    status: row.status,
    result: row.result,
    blockingCount: Number(row.blocking_count),
    warningCount: Number(row.warning_count),
    infoCount: Number(row.info_count),
    deterministicPassed: Boolean(row.deterministic_passed),
    aiAdvisoryStatus: row.ai_advisory_status,
    evaluationReportArtifactId: row.evaluation_report_artifact_id ?? null,
    evaluationReportRevisionNumber:
      row.evaluation_report_revision_number !== null
        ? Number(row.evaluation_report_revision_number)
        : null,
    evaluationReportContentHashHex:
      row.evaluation_report_content_hash !== null
        ? Buffer.from(row.evaluation_report_content_hash).toString('hex')
        : null,
    findings,
    createdAt: parseIsoTimestamp(
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    ),
    updatedAt: parseIsoTimestamp(
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    ),
  };
}

export async function queryReviewDecisions(
  client: pg.Pool | pg.PoolClient,
  workspaceId: string,
  artifactId: string,
): Promise<readonly ContentReviewDecisionDTO[]> {
  const res = await client.query(
    `SELECT id, workspace_id, artifact_id, revision_number, content_hash, evaluation_id,
            decision, actor_user_id, reason, metadata_json, created_at
     FROM content_review_decisions
     WHERE workspace_id = $1 AND artifact_id = $2
     ORDER BY created_at DESC`,
    [workspaceId, artifactId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    artifactId: row.artifact_id,
    revisionNumber: Number(row.revision_number),
    contentHashHex: Buffer.from(row.content_hash).toString('hex'),
    evaluationId: row.evaluation_id ?? null,
    decision: row.decision,
    actorUserId: row.actor_user_id,
    reason: row.reason ?? null,
    metadata: row.metadata_json ?? {},
    createdAt: parseIsoTimestamp(
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    ),
  }));
}

export async function queryApprovalSnapshot(
  client: pg.Pool | pg.PoolClient,
  workspaceId: string,
  artifactId: string,
  revisionNumber?: number | undefined,
): Promise<ContentApprovalSnapshotDTO | null> {
  let query: string;
  let params: unknown[];

  if (revisionNumber !== undefined) {
    query = `
      SELECT id, workspace_id, artifact_id, revision_number, content_hash, evaluation_id,
             policy_version, policy_hash, decision_id, approved_by_user_id, evidence_ids_json,
             disclosure_state_json, snapshot_json, snapshot_hash, created_at
      FROM content_approval_snapshots
      WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3
      LIMIT 1
    `;
    params = [workspaceId, artifactId, revisionNumber];
  } else {
    // Current revision
    query = `
      SELECT cas.id, cas.workspace_id, cas.artifact_id, cas.revision_number, cas.content_hash, cas.evaluation_id,
             cas.policy_version, cas.policy_hash, cas.decision_id, cas.approved_by_user_id, cas.evidence_ids_json,
             cas.disclosure_state_json, cas.snapshot_json, cas.snapshot_hash, cas.created_at
      FROM content_approval_snapshots cas
      JOIN content_artifacts ca ON ca.id = cas.artifact_id AND ca.workspace_id = cas.workspace_id
      WHERE cas.workspace_id = $1 AND cas.artifact_id = $2 AND cas.revision_number = ca.current_revision_number
      LIMIT 1
    `;
    params = [workspaceId, artifactId];
  }

  const res = await client.query(query, params);
  if (res.rowCount === 0 || !res.rows[0]) {
    return null;
  }
  const row = res.rows[0];

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    artifactId: row.artifact_id,
    revisionNumber: Number(row.revision_number),
    contentHashHex: Buffer.from(row.content_hash).toString('hex'),
    evaluationId: row.evaluation_id,
    policyVersion: row.policy_version,
    policyHashHex: Buffer.from(row.policy_hash).toString('hex'),
    decisionId: row.decision_id,
    approvedByUserId: row.approved_by_user_id,
    evidenceIds: Array.isArray(row.evidence_ids_json) ? row.evidence_ids_json : [],
    disclosureState: row.disclosure_state_json ?? {},
    snapshot: row.snapshot_json ?? {},
    snapshotHashHex: Buffer.from(row.snapshot_hash).toString('hex'),
    createdAt: parseIsoTimestamp(
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    ),
  };
}
