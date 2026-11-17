import crypto from 'node:crypto';
import type pg from 'pg';
import {
  generateUuidV7,
  JobLeaseExpiredError,
  type ExecuteComplianceAdvisoryResult,
  type AIScriptComplianceInput,
} from '@affiliate-content-os/application';
import {
  CURRENT_COMPLIANCE_POLICY_VERSION,
  computeCompliancePolicyHash,
  computeFindingFingerprint,
  evaluateDeterministicCompliance,
  parseProductId,
  parseWorkOrderId,
  parseWorkspaceId,
  type ComplianceFinding,
  type ComplianceReportContent,
  type DeterministicComplianceResult,
  type ScriptPackage,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

export interface BriefSnapshot {
  readonly briefHashHex: string;
  readonly briefVersion: number;
}

export interface PlanningRevisionsSnapshot {
  readonly productCampaignPlanRevisionId: string;
  readonly productCampaignPlanRevisionNumber: number;
  readonly audienceInsightBoardRevisionId: string;
  readonly audienceInsightBoardRevisionNumber: number;
  readonly videoSeriesPlanRevisionId: string;
  readonly videoSeriesPlanRevisionNumber: number;
}

export interface ContextPackageSnapshot {
  readonly contextPackageId: string;
  readonly allowedFactIds: readonly string[];
  readonly allowedAnalysisIds: readonly string[];
  readonly revokedEvidenceIds: readonly string[];
}

export interface PrepareComplianceReviewParams {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly jobVersion: number;
  readonly workerId: string;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly evaluationId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly policyVersion?: string | undefined;
  readonly expectedContentHashHex?: string | undefined;
}

export type PrepareComplianceResult =
  | { readonly kind: 'already_terminal'; readonly evaluationId: string }
  | { readonly kind: 'drift_detected'; readonly reason: string; readonly reservedSpend: number }
  | {
      readonly kind: 'preflight_blocked';
      readonly deterministicResult: DeterministicComplianceResult;
      readonly scriptContent: ScriptPackage;
      readonly contentHashHex: string;
      readonly reservedSpend: number;
    }
  | {
      readonly kind: 'budget_exhausted';
      readonly deterministicResult: DeterministicComplianceResult;
      readonly scriptContent: ScriptPackage;
      readonly contentHashHex: string;
      readonly reservedSpend: number;
    }
  | {
      readonly kind: 'execute_advisory';
      readonly providerInput: AIScriptComplianceInput;
      readonly providerInputHash: string;
      readonly deterministicResult: DeterministicComplianceResult;
      readonly scriptContent: ScriptPackage;
      readonly contentHashHex: string;
      readonly reservedSpend: number;
      readonly policyVersion: string;
      readonly policyHashHex: string;
      readonly briefSnapshot: BriefSnapshot;
      readonly planningRevisionsSnapshot: PlanningRevisionsSnapshot;
      readonly contextPackageSnapshot: ContextPackageSnapshot;
    };

export async function prepareComplianceReviewExecution(
  client: pg.PoolClient,
  params: PrepareComplianceReviewParams,
): Promise<PrepareComplianceResult> {
  const {
    workspaceId,
    jobId,
    jobVersion,
    workerId,
    operationId,
    aiRunId,
    evaluationId,
    productId,
    workOrderId,
    artifactId,
    revisionNumber,
    policyVersion = CURRENT_COMPLIANCE_POLICY_VERSION,
  } = params;

  // 1. Lease check on job execution
  const jobRes = await client.query(
    `SELECT id, workspace_id, status, version, lease_owner, lease_expires_at,
            (lease_expires_at < NOW()) AS is_lease_expired,
            operation_id, ai_run_id, work_order_id, work_item_id, reserved_spend_microunits
     FROM job_executions
     WHERE id = $1 AND workspace_id = $2`,
    [jobId, workspaceId],
  );

  if (jobRes.rowCount === 0 || !jobRes.rows[0]) {
    throw new DatabaseError(`Job execution ${jobId} not found`);
  }
  const job = jobRes.rows[0];

  if (
    job.is_lease_expired ||
    !job.lease_expires_at ||
    Number(job.version) !== jobVersion ||
    job.lease_owner !== workerId ||
    job.status !== 'running'
  ) {
    throw new JobLeaseExpiredError(jobId);
  }

  // Structural linkage checks
  if (
    job.operation_id !== operationId ||
    job.ai_run_id !== aiRunId ||
    job.work_order_id !== workOrderId
  ) {
    throw new DatabaseError(`Structural linkage mismatch on job ${jobId}`);
  }

  const reservedSpend = Number(job.reserved_spend_microunits ?? 0);

  // 2. Check operation and AI run
  const opRes = await client.query(
    `SELECT id, status, resource_id, operation_type, work_order_id
     FROM operations
     WHERE id = $1 AND workspace_id = $2`,
    [operationId, workspaceId],
  );
  if (opRes.rowCount === 0 || !opRes.rows[0]) {
    throw new DatabaseError(`Operation ${operationId} not found`);
  }
  if (opRes.rows[0].status === 'succeeded' || opRes.rows[0].status === 'failed') {
    return { kind: 'already_terminal', evaluationId };
  }
  if (
    opRes.rows[0].resource_id !== productId ||
    opRes.rows[0].operation_type !== 'compliance_review' ||
    opRes.rows[0].work_order_id !== workOrderId
  ) {
    throw new DatabaseError(`Operation structural linkage mismatch on ${operationId}`);
  }

  const runRes = await client.query(
    `SELECT id, status, purpose, work_order_id
     FROM ai_runs
     WHERE id = $1 AND workspace_id = $2`,
    [aiRunId, workspaceId],
  );
  if (runRes.rowCount === 0 || !runRes.rows[0]) {
    throw new DatabaseError(`AI run ${aiRunId} not found`);
  }
  if (runRes.rows[0].status === 'succeeded' || runRes.rows[0].status === 'failed') {
    return { kind: 'already_terminal', evaluationId };
  }
  if (
    runRes.rows[0].purpose !== 'compliance_review' ||
    runRes.rows[0].work_order_id !== workOrderId
  ) {
    throw new DatabaseError(`AI run structural linkage mismatch on ${aiRunId}`);
  }

  // 3. Check evaluation
  const evalRes = await client.query(
    `SELECT id, status, result, policy_version, policy_hash, revision_number, script_content_hash
     FROM compliance_evaluations
     WHERE id = $1 AND workspace_id = $2`,
    [evaluationId, workspaceId],
  );
  if (evalRes.rowCount === 0 || !evalRes.rows[0]) {
    throw new DatabaseError(`Evaluation ${evaluationId} not found`);
  }
  if (evalRes.rows[0].status === 'completed' || evalRes.rows[0].status === 'failed') {
    return { kind: 'already_terminal', evaluationId };
  }

  // 4. Revision & Content hash checks
  const artRes = await client.query(
    `SELECT current_revision_number
     FROM content_artifacts
     WHERE workspace_id = $1 AND id = $2 AND product_id = $3 AND work_order_id = $4`,
    [workspaceId, artifactId, productId, workOrderId],
  );
  if (artRes.rowCount === 0 || !artRes.rows[0]) {
    throw new DatabaseError(`Artifact ${artifactId} not found in workspace`);
  }
  if (Number(artRes.rows[0].current_revision_number) !== revisionNumber) {
    return {
      kind: 'drift_detected',
      reason: `Artifact current revision has drifted (current ${artRes.rows[0].current_revision_number}, requested ${revisionNumber})`,
      reservedSpend,
    };
  }

  const revRes = await client.query(
    `SELECT content_json, content_hash
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (revRes.rowCount === 0 || !revRes.rows[0]) {
    throw new DatabaseError(
      `Script revision ${revisionNumber} not found for artifact ${artifactId}`,
    );
  }
  const scriptContent = revRes.rows[0].content_json as ScriptPackage;
  const contentHashHex = Buffer.from(revRes.rows[0].content_hash).toString('hex');

  // Verify evaluation record script content hash matches revision content hash
  const evalScriptHashHex = Buffer.from(evalRes.rows[0].script_content_hash).toString('hex');
  if (evalScriptHashHex.toLowerCase() !== contentHashHex.toLowerCase()) {
    return {
      kind: 'drift_detected',
      reason: `Script content hash in evaluation record does not match artifact revision: eval=${evalScriptHashHex}, rev=${contentHashHex}`,
      reservedSpend,
    };
  }

  // Verify persisted hash matches expected content hash if provided
  if (
    params.expectedContentHashHex &&
    params.expectedContentHashHex.toLowerCase() !== contentHashHex.toLowerCase()
  ) {
    return {
      kind: 'drift_detected',
      reason: `Script content hash mismatch: expected ${params.expectedContentHashHex}, found ${contentHashHex}`,
      reservedSpend,
    };
  }

  // 5. Code-owned policy version & hash checks
  const currentCodePolicyVersion = CURRENT_COMPLIANCE_POLICY_VERSION;
  const currentCodePolicyHash = computeCompliancePolicyHash(currentCodePolicyVersion);
  const evalPolicyVersion = evalRes.rows[0].policy_version;
  const evalPolicyHashHex = Buffer.from(evalRes.rows[0].policy_hash).toString('hex');

  if (
    evalPolicyVersion !== currentCodePolicyVersion ||
    evalPolicyHashHex.toLowerCase() !== currentCodePolicyHash.toLowerCase() ||
    policyVersion !== currentCodePolicyVersion
  ) {
    return {
      kind: 'drift_detected',
      reason: `Compliance policy drifted (evaluation has ${evalPolicyVersion}, current code policy is ${currentCodePolicyVersion})`,
      reservedSpend,
    };
  }

  // 6. Check script revision lineage (expected content brief hash and planning revisions)
  const lineageRes = await client.query(
    `SELECT content_brief_hash, content_brief_version, planning_revision_ids_json
     FROM content_artifact_lineage
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (lineageRes.rowCount === 0 || !lineageRes.rows[0]) {
    return {
      kind: 'drift_detected',
      reason: `Lineage not found for script revision ${revisionNumber}`,
      reservedSpend,
    };
  }

  const expectedBriefHashHex = Buffer.from(lineageRes.rows[0].content_brief_hash).toString('hex');
  const expectedPlanningRevs = lineageRes.rows[0].planning_revision_ids_json as {
    readonly productCampaignPlanRevisionId?: string;
    readonly productCampaignPlanRevisionNumber?: number;
    readonly audienceInsightBoardRevisionId?: string;
    readonly audienceInsightBoardRevisionNumber?: number;
    readonly videoSeriesPlanRevisionId?: string;
    readonly videoSeriesPlanRevisionNumber?: number;
  };

  // 7. Check current content brief
  const briefRes = await client.query(
    `SELECT brief_hash, brief_version
     FROM content_briefs
     WHERE workspace_id = $1 AND work_order_id = $2
     ORDER BY brief_version DESC LIMIT 1`,
    [workspaceId, workOrderId],
  );
  if (briefRes.rowCount === 0 || !briefRes.rows[0]) {
    return {
      kind: 'drift_detected',
      reason: `Content brief not found for work order ${workOrderId}`,
      reservedSpend,
    };
  }
  const actualBriefHashHex = Buffer.from(briefRes.rows[0].brief_hash).toString('hex');
  if (expectedBriefHashHex.toLowerCase() !== actualBriefHashHex.toLowerCase()) {
    return {
      kind: 'drift_detected',
      reason: `Authoritative content brief hash drifted from script lineage`,
      reservedSpend,
    };
  }

  // 8. Check current planning revisions
  const planningRes = await client.query<{
    artifact_type: string;
    current_revision_number: number;
    current_revision_id: string;
  }>(
    `SELECT a.artifact_type, a.current_revision_number, r.id AS current_revision_id
     FROM content_artifacts a
     JOIN content_artifact_revisions r
       ON r.artifact_id = a.id
      AND r.revision_number = a.current_revision_number
      AND r.workspace_id = a.workspace_id
     WHERE a.workspace_id = $1 AND a.work_order_id = $2 AND a.product_id = $3
       AND a.artifact_type IN ('product_campaign_plan', 'audience_insight_board', 'video_series_plan')`,
    [workspaceId, workOrderId, productId],
  );

  const planningMap = new Map(planningRes.rows.map((r) => [r.artifact_type, r]));
  const campaignRow = planningMap.get('product_campaign_plan');
  const audienceRow = planningMap.get('audience_insight_board');
  const seriesRow = planningMap.get('video_series_plan');

  const isPlanningDrift =
    planningRes.rowCount !== 3 ||
    !campaignRow ||
    campaignRow.current_revision_id !== expectedPlanningRevs.productCampaignPlanRevisionId ||
    campaignRow.current_revision_number !==
      expectedPlanningRevs.productCampaignPlanRevisionNumber ||
    !audienceRow ||
    audienceRow.current_revision_id !== expectedPlanningRevs.audienceInsightBoardRevisionId ||
    audienceRow.current_revision_number !==
      expectedPlanningRevs.audienceInsightBoardRevisionNumber ||
    !seriesRow ||
    seriesRow.current_revision_id !== expectedPlanningRevs.videoSeriesPlanRevisionId ||
    seriesRow.current_revision_number !== expectedPlanningRevs.videoSeriesPlanRevisionNumber;

  if (isPlanningDrift) {
    return {
      kind: 'drift_detected',
      reason: 'Authoritative planning revisions drifted after script package synthesis',
      reservedSpend,
    };
  }

  // 9. Load authoritative evidence
  const woRes = await client.query(
    `SELECT context_package_id FROM work_orders WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, workOrderId],
  );
  if (woRes.rowCount === 0 || !woRes.rows[0]) {
    throw new DatabaseError(`Work order ${workOrderId} not found`);
  }
  const contextPackageId = woRes.rows[0].context_package_id;

  // Allowed facts
  const factsRes = await client.query(
    `SELECT f.id
     FROM product_facts f
     JOIN context_packages cp ON cp.fact_set_id = f.fact_set_id AND cp.workspace_id = f.workspace_id
     WHERE cp.workspace_id = $1 AND cp.id = $2 AND f.confidence = 'confirmed' AND f.claim_usage = 'allowed'`,
    [workspaceId, contextPackageId],
  );
  const allowedFactIds = new Set(factsRes.rows.map((r) => r.id));

  // Allowed analyses
  const analysesRes = await client.query(
    `SELECT cpa.analysis_id AS id
     FROM context_package_analyses cpa
     JOIN analyses a ON a.id = cpa.analysis_id AND a.workspace_id = cpa.workspace_id
     WHERE cpa.workspace_id = $1 AND cpa.context_package_id = $2 AND a.status = 'accepted'`,
    [workspaceId, contextPackageId],
  );
  const allowedAnalysisIds = new Set(analysesRes.rows.map((r) => r.id));

  // Revoked / superseded evidence
  const revokedRes = await client.query(
    `SELECT f.id
     FROM product_facts f
     JOIN context_packages cp ON cp.fact_set_id = f.fact_set_id AND cp.workspace_id = f.workspace_id
     WHERE cp.workspace_id = $1 AND cp.id = $2 AND (f.confidence != 'confirmed' OR f.claim_usage != 'allowed')
     UNION
     SELECT cpa.analysis_id AS id
     FROM context_package_analyses cpa
     JOIN analyses a ON a.id = cpa.analysis_id AND a.workspace_id = cpa.workspace_id
     WHERE cpa.workspace_id = $1 AND cpa.context_package_id = $2 AND a.status != 'accepted'`,
    [workspaceId, contextPackageId],
  );
  const revokedEvidenceIds = new Set(revokedRes.rows.map((r) => r.id));

  // 10. Run deterministic preflight
  const detResult = evaluateDeterministicCompliance({
    scriptPackage: scriptContent,
    expectedArtifactId: artifactId,
    expectedRevisionNumber: revisionNumber,
    expectedContentHashHex: params.expectedContentHashHex ?? contentHashHex,
    actualContentHashHex: contentHashHex,
    allowedFactIds,
    allowedAnalysisIds,
    revokedEvidenceIds,
    expectedBriefHashHex,
    actualBriefHashHex,
  });

  if (!detResult.passed) {
    return {
      kind: 'preflight_blocked',
      deterministicResult: detResult,
      scriptContent,
      contentHashHex,
      reservedSpend,
    };
  }

  // 11. Check budget reservation for advisory call
  if (reservedSpend <= 0) {
    return {
      kind: 'budget_exhausted',
      deterministicResult: detResult,
      scriptContent,
      contentHashHex,
      reservedSpend: 0,
    };
  }

  // 12. Snapshot provider input and durable context state
  const providerInput: AIScriptComplianceInput = {
    workspaceId: parseWorkspaceId(workspaceId),
    productId: parseProductId(productId),
    workOrderId: parseWorkOrderId(workOrderId),
    artifactId,
    revisionNumber,
    scriptPackage: scriptContent,
  };

  const providerInputHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(providerInput), 'utf8')
    .digest('hex');

  const briefSnapshot: BriefSnapshot = {
    briefHashHex: actualBriefHashHex,
    briefVersion: Number(briefRes.rows[0].brief_version),
  };

  const planningRevisionsSnapshot: PlanningRevisionsSnapshot = {
    productCampaignPlanRevisionId: campaignRow.current_revision_id,
    productCampaignPlanRevisionNumber: campaignRow.current_revision_number,
    audienceInsightBoardRevisionId: audienceRow.current_revision_id,
    audienceInsightBoardRevisionNumber: audienceRow.current_revision_number,
    videoSeriesPlanRevisionId: seriesRow.current_revision_id,
    videoSeriesPlanRevisionNumber: seriesRow.current_revision_number,
  };

  const contextPackageSnapshot: ContextPackageSnapshot = {
    contextPackageId,
    allowedFactIds: Array.from(allowedFactIds).sort(),
    allowedAnalysisIds: Array.from(allowedAnalysisIds).sort(),
    revokedEvidenceIds: Array.from(revokedEvidenceIds).sort(),
  };

  return {
    kind: 'execute_advisory',
    providerInput,
    providerInputHash,
    deterministicResult: detResult,
    scriptContent,
    contentHashHex,
    reservedSpend,
    policyVersion: currentCodePolicyVersion,
    policyHashHex: currentCodePolicyHash,
    briefSnapshot,
    planningRevisionsSnapshot,
    contextPackageSnapshot,
  };
}

export interface SettleCompliancePreflightBlockerParams {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly jobVersion: number;
  readonly workerId: string;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly evaluationId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly scriptContent: ScriptPackage;
  readonly contentHashHex: string;
  readonly deterministicResult: DeterministicComplianceResult;
  readonly reservedSpend: number;
  readonly policyVersion?: string | undefined;
}

export async function settleCompliancePreflightBlockerAtomic(
  client: pg.PoolClient,
  params: SettleCompliancePreflightBlockerParams,
): Promise<{ readonly status: 'blocked'; readonly evaluationId: string }> {
  const {
    workspaceId,
    jobId,
    jobVersion,
    workerId,
    operationId,
    aiRunId,
    evaluationId,
    productId,
    workOrderId,
    artifactId,
    revisionNumber,
    deterministicResult,
    contentHashHex,
    reservedSpend,
    policyVersion = CURRENT_COMPLIANCE_POLICY_VERSION,
  } = params;

  // 1. Verify lease
  const jobRes = await client.query(
    `SELECT id, status, version, lease_owner, lease_expires_at,
            (lease_expires_at < NOW()) AS is_lease_expired,
            work_item_id
     FROM job_executions
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [jobId, workspaceId],
  );
  if (jobRes.rowCount === 0 || !jobRes.rows[0]) throw new DatabaseError(`Job ${jobId} not found`);
  const job = jobRes.rows[0];
  if (
    job.is_lease_expired ||
    !job.lease_expires_at ||
    Number(job.version) !== jobVersion ||
    job.lease_owner !== workerId ||
    job.status !== 'running'
  ) {
    throw new JobLeaseExpiredError(jobId);
  }

  // 2. Release full budget reservation (exact-once)
  if (reservedSpend > 0) {
    const budgetRes = await client.query(
      `UPDATE workspace_ai_policies
       SET reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $1),
           updated_at = NOW(),
           version = version + 1
       WHERE workspace_id = $2`,
      [reservedSpend, workspaceId],
    );
    if (budgetRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to release budget reservation for workspace ${workspaceId}`);
    }
  }

  // 3. Persist findings
  for (const f of deterministicResult.findings) {
    await client.query(
      `INSERT INTO compliance_findings (
         id, workspace_id, evaluation_id, fingerprint, code, severity, source,
         video_number, field_path, message, evidence_ids_json, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
       ON CONFLICT (workspace_id, evaluation_id, fingerprint) DO NOTHING`,
      [
        generateUuidV7(),
        workspaceId,
        evaluationId,
        Buffer.from(f.fingerprint, 'hex'),
        f.code,
        f.severity,
        f.source,
        f.videoNumber,
        f.fieldPath,
        f.message,
        JSON.stringify(f.evidenceIds),
      ],
    );
  }

  // 4. Create compliance_report artifact
  const { reportArtifactId, reportRevNum } = await findOrCreateReportArtifact(
    client,
    workspaceId,
    productId,
    workOrderId,
    job.work_item_id,
  );

  const reportContent: ComplianceReportContent = {
    schemaVersion: 1,
    policyVersion,
    policyHash: deterministicResult.policyHash,
    scriptArtifactId: artifactId,
    scriptRevisionNumber: revisionNumber,
    scriptContentHash: contentHashHex,
    result: 'blocked',
    blockingCount: deterministicResult.blockingCount,
    warningCount: deterministicResult.warningCount,
    infoCount: deterministicResult.infoCount,
    deterministicPassed: false,
    aiAdvisoryStatus: 'skipped',
    findings: deterministicResult.findings,
    summary: `Gói kịch bản bị chặn do phát hiện ${deterministicResult.blockingCount} vi phạm quy tắc tuân thủ nghiêm ngặt.`,
    evaluatedAt: new Date().toISOString(),
  };

  const reportHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(reportContent), 'utf8').digest(),
  );

  await client.query(
    `INSERT INTO content_artifact_revisions (
       id, workspace_id, artifact_id, revision_number, content_json,
       content_hash, schema_version, prompt_template, prompt_version,
       provider, model, token_input, token_output, cost_microunits,
       cost_currency, latency_ms, author_role_key, created_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb,
       $6, 1, 'compliance_policy', $7,
       'deterministic', 'rule_engine', 0, 0, 0,
       'USD', 0, 'compliance_reviewer', NOW()
     )`,
    [
      generateUuidV7(),
      workspaceId,
      reportArtifactId,
      reportRevNum,
      JSON.stringify(reportContent),
      Buffer.from(reportHash),
      policyVersion,
    ],
  );

  // 5. Update evaluation
  const evalUpdateRes = await client.query(
    `UPDATE compliance_evaluations
     SET status = 'completed',
         result = 'blocked',
         blocking_count = $1,
         warning_count = $2,
         info_count = $3,
         deterministic_passed = FALSE,
         ai_advisory_status = 'skipped',
         evaluation_report_artifact_id = $4,
         evaluation_report_revision_number = $5,
         evaluation_report_content_hash = $6,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $7 AND workspace_id = $8 AND status IN ('queued', 'running')`,
    [
      deterministicResult.blockingCount,
      deterministicResult.warningCount,
      deterministicResult.infoCount,
      reportArtifactId,
      reportRevNum,
      Buffer.from(reportHash),
      evaluationId,
      workspaceId,
    ],
  );
  if (evalUpdateRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update compliance_evaluations ${evaluationId}`);
  }

  // 6. Update operation, ai_run, and job execution
  const resultLocation = `/artifacts/${reportArtifactId}/revisions/${reportRevNum}`;
  const opRes = await client.query(
    `UPDATE operations
     SET status = 'succeeded', progress_percent = 100, result_location = $1,
         started_at = COALESCE(started_at, NOW()), completed_at = NOW(),
         error_category = NULL, error_code = NULL, error_message = NULL,
         updated_at = NOW(), version = version + 1
     WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
    [resultLocation, operationId, workspaceId],
  );
  if (opRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update operations ${operationId}`);
  }

  const runRes = await client.query(
    `UPDATE ai_runs
     SET status = 'succeeded', provider = 'deterministic', model = 'rule_engine',
         started_at = COALESCE(started_at, NOW()), completed_at = NOW(),
         output_hash = $1, cost_microunits = 0, token_input = 0, token_output = 0,
         updated_at = NOW(), version = version + 1
     WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
    [Buffer.from(reportHash), aiRunId, workspaceId],
  );
  if (runRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update ai_runs ${aiRunId}`);
  }

  const jobUpdateRes = await client.query(
    `UPDATE job_executions
     SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
         reserved_spend_microunits = 0,
         started_at = COALESCE(started_at, NOW()), completed_at = NOW(),
         last_error_category = NULL, updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status = 'running' AND lease_owner = $3 AND version = $4`,
    [jobId, workspaceId, workerId, jobVersion],
  );
  if (jobUpdateRes.rowCount !== 1) {
    throw new JobLeaseExpiredError(jobId);
  }

  // 7. Work item & assignment
  if (job.work_item_id) {
    const itemRes = await client.query(
      `UPDATE work_items
       SET status = 'review_required', started_at = COALESCE(started_at, NOW()), completed_at = NULL, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [job.work_item_id, workspaceId],
    );
    if (itemRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update work_items ${job.work_item_id}`);
    }
    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'review_required', updated_at = NOW(), version = version + 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND work_item_id = $3`,
      [workspaceId, workOrderId, job.work_item_id],
    );
  }

  return { status: 'blocked', evaluationId };
}

export interface SettleComplianceBudgetExhaustedParams {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly jobVersion: number;
  readonly workerId: string;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly evaluationId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly deterministicResult: DeterministicComplianceResult;
}

export async function settleComplianceBudgetExhaustedAtomic(
  client: pg.PoolClient,
  params: SettleComplianceBudgetExhaustedParams,
): Promise<{ readonly status: 'budget_exhausted'; readonly evaluationId: string }> {
  const {
    workspaceId,
    jobId,
    jobVersion,
    workerId,
    operationId,
    aiRunId,
    evaluationId,
    workOrderId,
    deterministicResult,
  } = params;

  // Verify lease
  const jobRes = await client.query(
    `SELECT id, status, version, lease_owner, lease_expires_at,
            (lease_expires_at < NOW()) AS is_lease_expired,
            work_item_id, reserved_spend_microunits
     FROM job_executions
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [jobId, workspaceId],
  );
  if (jobRes.rowCount === 0 || !jobRes.rows[0]) throw new DatabaseError(`Job ${jobId} not found`);
  const job = jobRes.rows[0];
  if (
    job.is_lease_expired ||
    !job.lease_expires_at ||
    Number(job.version) !== jobVersion ||
    job.lease_owner !== workerId ||
    job.status !== 'running'
  ) {
    throw new JobLeaseExpiredError(jobId);
  }

  const reserved = Number(job.reserved_spend_microunits ?? 0);
  if (reserved > 0) {
    const budgetRes = await client.query(
      `UPDATE workspace_ai_policies
       SET reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $1),
           updated_at = NOW(), version = version + 1
       WHERE workspace_id = $2`,
      [reserved, workspaceId],
    );
    if (budgetRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to release budget reservation for workspace ${workspaceId}`);
    }
  }

  // Persist findings from deterministic checks for transparency
  for (const f of deterministicResult.findings) {
    await client.query(
      `INSERT INTO compliance_findings (
         id, workspace_id, evaluation_id, fingerprint, code, severity, source,
         video_number, field_path, message, evidence_ids_json, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
       ON CONFLICT (workspace_id, evaluation_id, fingerprint) DO NOTHING`,
      [
        generateUuidV7(),
        workspaceId,
        evaluationId,
        Buffer.from(f.fingerprint, 'hex'),
        f.code,
        f.severity,
        f.source,
        f.videoNumber,
        f.fieldPath,
        f.message,
        JSON.stringify(f.evidenceIds),
      ],
    );
  }

  // Update evaluation to non-approvable failed state
  const evalUpdateRes = await client.query(
    `UPDATE compliance_evaluations
     SET status = 'failed',
         result = 'failed',
         blocking_count = $1,
         warning_count = $2,
         info_count = $3,
         deterministic_passed = TRUE,
         ai_advisory_status = 'failed',
         evaluation_report_artifact_id = NULL,
         evaluation_report_revision_number = NULL,
         evaluation_report_content_hash = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $4 AND workspace_id = $5 AND status IN ('queued', 'running')`,
    [
      deterministicResult.blockingCount,
      deterministicResult.warningCount,
      deterministicResult.infoCount,
      evaluationId,
      workspaceId,
    ],
  );
  if (evalUpdateRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update compliance_evaluations ${evaluationId}`);
  }

  // Update operation, ai_run, and job execution to failed
  const opUpdateRes = await client.query(
    `UPDATE operations
     SET status = 'failed', progress_percent = NULL,
         error_category = 'budget_exhausted', error_code = 'BUDGET_EXHAUSTED',
         error_message = 'Ngân sách AI của workspace không đủ để thực hiện đánh giá tuân thủ AI.',
         completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
    [operationId, workspaceId],
  );
  if (opUpdateRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update operations ${operationId}`);
  }

  const runUpdateRes = await client.query(
    `UPDATE ai_runs
     SET status = 'failed', error_category = 'budget_exhausted',
         completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
    [aiRunId, workspaceId],
  );
  if (runUpdateRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update ai_runs ${aiRunId}`);
  }

  const jobUpdateRes = await client.query(
    `UPDATE job_executions
     SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
         reserved_spend_microunits = 0, last_error_category = 'budget_exhausted',
         completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status = 'running' AND lease_owner = $3 AND version = $4`,
    [jobId, workspaceId, workerId, jobVersion],
  );
  if (jobUpdateRes.rowCount !== 1) {
    throw new JobLeaseExpiredError(jobId);
  }

  // Work item & assignment remain in failed / review_required state
  if (job.work_item_id) {
    await client.query(
      `UPDATE work_items
       SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [job.work_item_id, workspaceId],
    );
    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'failed', updated_at = NOW(), version = version + 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND work_item_id = $3`,
      [workspaceId, workOrderId, job.work_item_id],
    );
  }

  return { status: 'budget_exhausted', evaluationId };
}

export interface SettleComplianceDriftParams {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly jobVersion: number;
  readonly workerId: string;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly evaluationId: string;
  readonly workOrderId: string;
  readonly reason: string;
  readonly reservedSpend: number;
}

export async function settleComplianceDriftAtomic(
  client: pg.PoolClient,
  params: SettleComplianceDriftParams,
): Promise<{ readonly status: 'drift_canceled'; readonly evaluationId: string }> {
  const {
    workspaceId,
    jobId,
    jobVersion,
    workerId,
    operationId,
    aiRunId,
    evaluationId,
    workOrderId,
    reason,
    reservedSpend,
  } = params;

  // Verify lease
  const jobRes = await client.query(
    `SELECT id, status, version, lease_owner, lease_expires_at,
            (lease_expires_at < NOW()) AS is_lease_expired,
            work_item_id
     FROM job_executions
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [jobId, workspaceId],
  );
  if (jobRes.rowCount === 0 || !jobRes.rows[0]) throw new DatabaseError(`Job ${jobId} not found`);
  const job = jobRes.rows[0];
  if (
    job.is_lease_expired ||
    !job.lease_expires_at ||
    Number(job.version) !== jobVersion ||
    job.lease_owner !== workerId ||
    job.status !== 'running'
  ) {
    throw new JobLeaseExpiredError(jobId);
  }

  // Release budget reservation exactly once
  if (reservedSpend > 0) {
    const budgetRes = await client.query(
      `UPDATE workspace_ai_policies
       SET reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $1),
           updated_at = NOW(), version = version + 1
       WHERE workspace_id = $2`,
      [reservedSpend, workspaceId],
    );
    if (budgetRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to release budget reservation for workspace ${workspaceId}`);
    }
  }

  // Mark evaluation as failed / non-approvable
  const evalUpdateRes = await client.query(
    `UPDATE compliance_evaluations
     SET status = 'failed', result = 'failed', ai_advisory_status = 'failed',
         evaluation_report_artifact_id = NULL,
         evaluation_report_revision_number = NULL,
         evaluation_report_content_hash = NULL,
         updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
    [evaluationId, workspaceId],
  );
  if (evalUpdateRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update compliance_evaluations ${evaluationId}`);
  }

  // Mark operation, ai_run, and job as failed
  const opUpdateRes = await client.query(
    `UPDATE operations
     SET status = 'failed', error_category = 'invalid_evidence', error_code = 'CONTEXT_DRIFT',
         error_message = $1, completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
    [reason, operationId, workspaceId],
  );
  if (opUpdateRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update operations ${operationId}`);
  }

  const runUpdateRes = await client.query(
    `UPDATE ai_runs
     SET status = 'failed', error_category = 'invalid_evidence',
         completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
    [aiRunId, workspaceId],
  );
  if (runUpdateRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update ai_runs ${aiRunId}`);
  }

  const jobUpdateRes = await client.query(
    `UPDATE job_executions
     SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
         reserved_spend_microunits = 0, last_error_category = 'invalid_evidence',
         completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status = 'running' AND lease_owner = $3 AND version = $4`,
    [jobId, workspaceId, workerId, jobVersion],
  );
  if (jobUpdateRes.rowCount !== 1) {
    throw new JobLeaseExpiredError(jobId);
  }

  if (job.work_item_id) {
    await client.query(
      `UPDATE work_items
       SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [job.work_item_id, workspaceId],
    );
    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'failed', updated_at = NOW(), version = version + 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND work_item_id = $3`,
      [workspaceId, workOrderId, job.work_item_id],
    );
  }

  return { status: 'drift_canceled', evaluationId };
}

export interface SettleComplianceReviewExecutionParams {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly jobVersion: number;
  readonly workerId: string;
  readonly operationId: string;
  readonly aiRunId: string;
  readonly evaluationId: string;
  readonly productId: string;
  readonly workOrderId: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly deterministicResult: DeterministicComplianceResult;
  readonly reservedSpend: number;
  readonly policyVersion: string;
  readonly policyHashHex: string;
  readonly providerInput: AIScriptComplianceInput;
  readonly providerInputHash: string;
  readonly briefSnapshot: BriefSnapshot;
  readonly planningRevisionsSnapshot: PlanningRevisionsSnapshot;
  readonly contextPackageSnapshot: ContextPackageSnapshot;
  readonly providerResult: ExecuteComplianceAdvisoryResult | null;
}

export async function settleComplianceReviewExecutionAtomic(
  client: pg.PoolClient,
  params: SettleComplianceReviewExecutionParams,
): Promise<{
  readonly status: 'completed' | 'drift_canceled' | 'failed';
  readonly evaluationId: string;
}> {
  const {
    workspaceId,
    jobId,
    jobVersion,
    workerId,
    operationId,
    aiRunId,
    evaluationId,
    productId,
    workOrderId,
    artifactId,
    revisionNumber,
    contentHashHex,
    deterministicResult,
    reservedSpend,
    policyVersion,
    policyHashHex,
    providerInput,
    providerInputHash,
    briefSnapshot,
    planningRevisionsSnapshot,
    contextPackageSnapshot,
    providerResult,
  } = params;

  // 1. Post-provider fencing: provider input hash re-verification
  const computedProviderInputHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(providerInput), 'utf8')
    .digest('hex');
  if (computedProviderInputHash.toLowerCase() !== providerInputHash.toLowerCase()) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: 'Post-provider input hash does not match prepared provider input',
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  // 2. Post-provider fencing: lease check
  const jobRes = await client.query(
    `SELECT id, status, version, lease_owner, lease_expires_at,
            (lease_expires_at < NOW()) AS is_lease_expired,
            operation_id, ai_run_id, work_order_id, work_item_id
     FROM job_executions
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [jobId, workspaceId],
  );
  if (jobRes.rowCount === 0 || !jobRes.rows[0]) throw new DatabaseError(`Job ${jobId} not found`);
  const job = jobRes.rows[0];

  if (
    job.is_lease_expired ||
    !job.lease_expires_at ||
    Number(job.version) !== jobVersion ||
    job.lease_owner !== workerId ||
    job.status !== 'running'
  ) {
    throw new JobLeaseExpiredError(jobId);
  }

  // 3. Post-provider fencing: artifact current revision check
  const artRes = await client.query(
    `SELECT current_revision_number
     FROM content_artifacts
     WHERE workspace_id = $1 AND id = $2 AND product_id = $3 AND work_order_id = $4`,
    [workspaceId, artifactId, productId, workOrderId],
  );
  if (artRes.rowCount === 0 || !artRes.rows[0])
    throw new DatabaseError(`Artifact ${artifactId} not found`);
  if (Number(artRes.rows[0].current_revision_number) !== revisionNumber) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: 'Post-provider artifact current revision drifted',
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  // Post-provider revision content hash check
  const revRes = await client.query(
    `SELECT content_hash
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (revRes.rowCount === 0 || !revRes.rows[0])
    throw new DatabaseError(`Revision ${revisionNumber} not found`);
  const actualHashHex = Buffer.from(revRes.rows[0].content_hash).toString('hex');
  if (actualHashHex.toLowerCase() !== contentHashHex.toLowerCase()) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: 'Post-provider script revision content hash drifted',
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  // Post-provider policy check
  const currentCodePolicyVersion = CURRENT_COMPLIANCE_POLICY_VERSION;
  const currentCodePolicyHash = computeCompliancePolicyHash(currentCodePolicyVersion);
  if (
    policyVersion !== currentCodePolicyVersion ||
    policyHashHex.toLowerCase() !== currentCodePolicyHash.toLowerCase()
  ) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: 'Post-provider code policy drifted',
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  // Post-provider lineage and brief check
  const lineageRes = await client.query(
    `SELECT content_brief_hash, content_brief_version, planning_revision_ids_json
     FROM content_artifact_lineage
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (lineageRes.rowCount === 0 || !lineageRes.rows[0]) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: `Lineage not found for script revision ${revisionNumber}`,
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  const expectedBriefHashHex = Buffer.from(lineageRes.rows[0].content_brief_hash).toString('hex');
  const briefRes = await client.query(
    `SELECT brief_hash, brief_version
     FROM content_briefs
     WHERE workspace_id = $1 AND work_order_id = $2
     ORDER BY brief_version DESC LIMIT 1`,
    [workspaceId, workOrderId],
  );
  if (briefRes.rowCount === 0 || !briefRes.rows[0]) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: `Content brief not found for work order ${workOrderId}`,
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }
  const actualBriefHashHex = Buffer.from(briefRes.rows[0].brief_hash).toString('hex');
  const actualBriefVersion = Number(briefRes.rows[0].brief_version);
  if (
    expectedBriefHashHex.toLowerCase() !== actualBriefHashHex.toLowerCase() ||
    actualBriefHashHex.toLowerCase() !== briefSnapshot.briefHashHex.toLowerCase() ||
    actualBriefVersion !== briefSnapshot.briefVersion
  ) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: 'Authoritative content brief drifted during compliance execution',
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  // Post-provider planning revisions check
  const planningRes = await client.query<{
    artifact_type: string;
    current_revision_number: number;
    current_revision_id: string;
  }>(
    `SELECT a.artifact_type, a.current_revision_number, r.id AS current_revision_id
     FROM content_artifacts a
     JOIN content_artifact_revisions r
       ON r.artifact_id = a.id
      AND r.revision_number = a.current_revision_number
      AND r.workspace_id = a.workspace_id
     WHERE a.workspace_id = $1 AND a.work_order_id = $2 AND a.product_id = $3
       AND a.artifact_type IN ('product_campaign_plan', 'audience_insight_board', 'video_series_plan')`,
    [workspaceId, workOrderId, productId],
  );

  const planningMap = new Map(planningRes.rows.map((r) => [r.artifact_type, r]));
  const campaignRow = planningMap.get('product_campaign_plan');
  const audienceRow = planningMap.get('audience_insight_board');
  const seriesRow = planningMap.get('video_series_plan');

  const isPlanningDrift =
    planningRes.rowCount !== 3 ||
    !campaignRow ||
    campaignRow.current_revision_id !== planningRevisionsSnapshot.productCampaignPlanRevisionId ||
    campaignRow.current_revision_number !==
      planningRevisionsSnapshot.productCampaignPlanRevisionNumber ||
    !audienceRow ||
    audienceRow.current_revision_id !== planningRevisionsSnapshot.audienceInsightBoardRevisionId ||
    audienceRow.current_revision_number !==
      planningRevisionsSnapshot.audienceInsightBoardRevisionNumber ||
    !seriesRow ||
    seriesRow.current_revision_id !== planningRevisionsSnapshot.videoSeriesPlanRevisionId ||
    seriesRow.current_revision_number !== planningRevisionsSnapshot.videoSeriesPlanRevisionNumber;

  if (isPlanningDrift) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: 'Authoritative planning revisions drifted during compliance execution',
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  // Post-provider context package & evidence check
  const woRes = await client.query(
    `SELECT context_package_id FROM work_orders WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, workOrderId],
  );
  if (
    woRes.rowCount === 0 ||
    !woRes.rows[0] ||
    woRes.rows[0].context_package_id !== contextPackageSnapshot.contextPackageId
  ) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: 'Authoritative context package drifted during compliance execution',
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  const cpId = contextPackageSnapshot.contextPackageId;
  const currentFactsRes = await client.query(
    `SELECT f.id
     FROM product_facts f
     JOIN context_packages cp ON cp.fact_set_id = f.fact_set_id AND cp.workspace_id = f.workspace_id
     WHERE cp.workspace_id = $1 AND cp.id = $2 AND f.confidence = 'confirmed' AND f.claim_usage = 'allowed'`,
    [workspaceId, cpId],
  );
  const currentAllowedFactIds = new Set(currentFactsRes.rows.map((r) => r.id));

  const currentAnalysesRes = await client.query(
    `SELECT cpa.analysis_id AS id
     FROM context_package_analyses cpa
     JOIN analyses a ON a.id = cpa.analysis_id AND a.workspace_id = cpa.workspace_id
     WHERE cpa.workspace_id = $1 AND cpa.context_package_id = $2 AND a.status = 'accepted'`,
    [workspaceId, cpId],
  );
  const currentAllowedAnalysisIds = new Set(currentAnalysesRes.rows.map((r) => r.id));

  const currentRevokedRes = await client.query(
    `SELECT f.id
     FROM product_facts f
     JOIN context_packages cp ON cp.fact_set_id = f.fact_set_id AND cp.workspace_id = f.workspace_id
     WHERE cp.workspace_id = $1 AND cp.id = $2 AND (f.confidence != 'confirmed' OR f.claim_usage != 'allowed')
     UNION
     SELECT cpa.analysis_id AS id
     FROM context_package_analyses cpa
     JOIN analyses a ON a.id = cpa.analysis_id AND a.workspace_id = cpa.workspace_id
     WHERE cpa.workspace_id = $1 AND cpa.context_package_id = $2 AND a.status != 'accepted'`,
    [workspaceId, cpId],
  );
  const currentRevokedIds = new Set(currentRevokedRes.rows.map((r) => r.id));

  const factsStillAllowed = contextPackageSnapshot.allowedFactIds.every((id) =>
    currentAllowedFactIds.has(id),
  );
  const analysesStillAllowed = contextPackageSnapshot.allowedAnalysisIds.every((id) =>
    currentAllowedAnalysisIds.has(id),
  );
  const noNewRevocations =
    contextPackageSnapshot.allowedFactIds.every((id) => !currentRevokedIds.has(id)) &&
    contextPackageSnapshot.allowedAnalysisIds.every((id) => !currentRevokedIds.has(id));

  if (!factsStillAllowed || !analysesStillAllowed || !noNewRevocations) {
    await settleComplianceDriftAtomic(client, {
      workspaceId,
      jobId,
      jobVersion,
      workerId,
      operationId,
      aiRunId,
      evaluationId,
      workOrderId,
      reason: 'Authoritative context evidence state drifted or was revoked during execution',
      reservedSpend,
    });
    return { status: 'drift_canceled', evaluationId };
  }

  // 4. Evaluate Provider Result
  const isProviderSuccess = Boolean(
    providerResult && providerResult.success && providerResult.content,
  );

  if (!isProviderSuccess) {
    if (reservedSpend > 0) {
      const budgetRes = await client.query(
        `UPDATE workspace_ai_policies
         SET reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $1),
             updated_at = NOW(), version = version + 1
         WHERE workspace_id = $2`,
        [reservedSpend, workspaceId],
      );
      if (budgetRes.rowCount !== 1) {
        throw new DatabaseError(`Failed to release budget reservation on provider failure`);
      }
    }

    // Persist deterministic findings
    for (const f of deterministicResult.findings) {
      await client.query(
        `INSERT INTO compliance_findings (
           id, workspace_id, evaluation_id, fingerprint, code, severity, source,
           video_number, field_path, message, evidence_ids_json, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
         ON CONFLICT (workspace_id, evaluation_id, fingerprint) DO NOTHING`,
        [
          generateUuidV7(),
          workspaceId,
          evaluationId,
          Buffer.from(f.fingerprint, 'hex'),
          f.code,
          f.severity,
          f.source,
          f.videoNumber,
          f.fieldPath,
          f.message,
          JSON.stringify(f.evidenceIds),
        ],
      );
    }

    // Mark evaluation as failed (NON-APPROVABLE)
    const evalUpdateRes = await client.query(
      `UPDATE compliance_evaluations
       SET status = 'failed', result = 'failed', ai_advisory_status = 'failed',
           blocking_count = $1, warning_count = $2, info_count = $3,
           deterministic_passed = TRUE, evaluation_report_artifact_id = NULL,
           evaluation_report_revision_number = NULL, evaluation_report_content_hash = NULL,
           updated_at = NOW(), version = version + 1
       WHERE id = $4 AND workspace_id = $5 AND status IN ('queued', 'running')`,
      [
        deterministicResult.blockingCount,
        deterministicResult.warningCount,
        deterministicResult.infoCount,
        evaluationId,
        workspaceId,
      ],
    );
    if (evalUpdateRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update compliance_evaluations ${evaluationId}`);
    }

    const safeCategory = providerResult?.errorCategory ?? 'provider_unavailable';
    const opUpdateRes = await client.query(
      `UPDATE operations
       SET status = 'failed', error_category = $1, error_code = 'PROVIDER_ERROR',
           error_message = 'Đánh giá tư vấn AI gặp lỗi từ phía nhà cung cấp mô hình.',
           completed_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
      [safeCategory, operationId, workspaceId],
    );
    if (opUpdateRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update operations ${operationId}`);
    }

    const runUpdateRes = await client.query(
      `UPDATE ai_runs
       SET status = 'failed', error_category = $1, completed_at = NOW(),
           updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
      [safeCategory, aiRunId, workspaceId],
    );
    if (runUpdateRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update ai_runs ${aiRunId}`);
    }

    const jobUpdateRes = await client.query(
      `UPDATE job_executions
       SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
           reserved_spend_microunits = 0, last_error_category = $1,
           completed_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND status = 'running' AND lease_owner = $4 AND version = $5`,
      [safeCategory, jobId, workspaceId, workerId, jobVersion],
    );
    if (jobUpdateRes.rowCount !== 1) {
      throw new JobLeaseExpiredError(jobId);
    }

    if (job.work_item_id) {
      await client.query(
        `UPDATE work_items
         SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), updated_at = NOW(), version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
        [job.work_item_id, workspaceId],
      );
      await client.query(
        `UPDATE agent_assignments
         SET office_state = 'failed', updated_at = NOW(), version = version + 1
         WHERE workspace_id = $1 AND work_order_id = $2 AND work_item_id = $3`,
        [workspaceId, workOrderId, job.work_item_id],
      );
    }

    return { status: 'failed', evaluationId };
  }

  // 5. Provider Succeeded -> Validate Cost (Fail Closed on invalid or over-reservation cost)
  const advisoryRes = providerResult!;
  const reportedCost = advisoryRes.usage.costMicrounits;
  const isCostValid =
    typeof reportedCost === 'number' &&
    Number.isFinite(reportedCost) &&
    Number.isInteger(reportedCost) &&
    reportedCost >= 0 &&
    reportedCost <= reservedSpend;

  if (!isCostValid) {
    if (reservedSpend > 0) {
      const budgetRes = await client.query(
        `UPDATE workspace_ai_policies
         SET reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $1),
             updated_at = NOW(), version = version + 1
         WHERE workspace_id = $2`,
        [reservedSpend, workspaceId],
      );
      if (budgetRes.rowCount !== 1) {
        throw new DatabaseError(`Failed to release budget reservation on invalid cost`);
      }
    }

    for (const f of deterministicResult.findings) {
      await client.query(
        `INSERT INTO compliance_findings (
           id, workspace_id, evaluation_id, fingerprint, code, severity, source,
           video_number, field_path, message, evidence_ids_json, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
         ON CONFLICT (workspace_id, evaluation_id, fingerprint) DO NOTHING`,
        [
          generateUuidV7(),
          workspaceId,
          evaluationId,
          Buffer.from(f.fingerprint, 'hex'),
          f.code,
          f.severity,
          f.source,
          f.videoNumber,
          f.fieldPath,
          f.message,
          JSON.stringify(f.evidenceIds),
        ],
      );
    }

    const evalUpdateRes = await client.query(
      `UPDATE compliance_evaluations
       SET status = 'failed', result = 'failed', ai_advisory_status = 'failed',
           blocking_count = $1, warning_count = $2, info_count = $3,
           deterministic_passed = TRUE, evaluation_report_artifact_id = NULL,
           evaluation_report_revision_number = NULL, evaluation_report_content_hash = NULL,
           updated_at = NOW(), version = version + 1
       WHERE id = $4 AND workspace_id = $5 AND status IN ('queued', 'running')`,
      [
        deterministicResult.blockingCount,
        deterministicResult.warningCount,
        deterministicResult.infoCount,
        evaluationId,
        workspaceId,
      ],
    );
    if (evalUpdateRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update compliance_evaluations ${evaluationId}`);
    }

    const errorMsg =
      reportedCost !== undefined && reportedCost > reservedSpend
        ? `Provider cost (${reportedCost}) exceeds reserved budget (${reservedSpend})`
        : `Provider cost is invalid (${reportedCost})`;

    const opUpdateRes = await client.query(
      `UPDATE operations
       SET status = 'failed', error_category = 'budget_exhausted', error_code = 'COST_EXCEEDS_RESERVATION',
           error_message = $1, completed_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
      [errorMsg, operationId, workspaceId],
    );
    if (opUpdateRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update operations ${operationId}`);
    }

    const runUpdateRes = await client.query(
      `UPDATE ai_runs
       SET status = 'failed', error_category = 'budget_exhausted', completed_at = NOW(),
           updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [aiRunId, workspaceId],
    );
    if (runUpdateRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update ai_runs ${aiRunId}`);
    }

    const jobUpdateRes = await client.query(
      `UPDATE job_executions
       SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
           reserved_spend_microunits = 0, last_error_category = 'budget_exhausted',
           completed_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status = 'running' AND lease_owner = $3 AND version = $4`,
      [jobId, workspaceId, workerId, jobVersion],
    );
    if (jobUpdateRes.rowCount !== 1) {
      throw new JobLeaseExpiredError(jobId);
    }

    if (job.work_item_id) {
      await client.query(
        `UPDATE work_items
         SET status = 'failed', started_at = COALESCE(started_at, NOW()), completed_at = NOW(), updated_at = NOW(), version = version + 1
         WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
        [job.work_item_id, workspaceId],
      );
      await client.query(
        `UPDATE agent_assignments
         SET office_state = 'failed', updated_at = NOW(), version = version + 1
         WHERE workspace_id = $1 AND work_order_id = $2 AND work_item_id = $3`,
        [workspaceId, workOrderId, job.work_item_id],
      );
    }

    return { status: 'failed', evaluationId };
  }

  // 6. Valid Cost: Settle Spend Atomically
  const actualSpend = reportedCost;
  if (reservedSpend > 0) {
    const budgetRes = await client.query(
      `UPDATE workspace_ai_policies
       SET current_spend_microunits = current_spend_microunits + $1,
           reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $2),
           updated_at = NOW(),
           version = version + 1
       WHERE workspace_id = $3`,
      [actualSpend, reservedSpend, workspaceId],
    );
    if (budgetRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to settle budget spend for workspace ${workspaceId}`);
    }
  }

  // 7. Constrain finding evidence IDs to authoritative context package snapshot
  const allowedEvidenceIdSet = new Set([
    ...contextPackageSnapshot.allowedFactIds,
    ...contextPackageSnapshot.allowedAnalysisIds,
  ]);

  const allFindings: ComplianceFinding[] = [...deterministicResult.findings];

  for (const f of advisoryRes.content?.findings ?? []) {
    const safeEvidenceIds = (f.evidenceIds ?? []).filter((id) => allowedEvidenceIdSet.has(id));
    const fp = computeFindingFingerprint({
      code: f.code,
      severity: f.severity === 'info' ? 'info' : 'warning',
      videoNumber: f.videoNumber ?? null,
      fieldPath: f.fieldPath,
      message: f.message,
    });
    allFindings.push({
      fingerprint: fp,
      code: f.code,
      severity: f.severity === 'info' ? 'info' : 'warning',
      source: 'ai_advisory',
      videoNumber: f.videoNumber ?? null,
      fieldPath: f.fieldPath,
      message: f.message,
      evidenceIds: Object.freeze(safeEvidenceIds),
    });
  }

  // Deduplicate findings by fingerprint
  const uniqueFindingsMap = new Map<string, ComplianceFinding>();
  for (const f of allFindings) {
    uniqueFindingsMap.set(f.fingerprint, f);
  }
  const finalFindings = Array.from(uniqueFindingsMap.values());

  const blockingCount = finalFindings.filter((f) => f.severity === 'blocking').length;
  const warningCount = finalFindings.filter((f) => f.severity === 'warning').length;
  const infoCount = finalFindings.filter((f) => f.severity === 'info').length;

  let finalEvalResult: 'passed' | 'warning' | 'blocked';
  if (blockingCount > 0) {
    finalEvalResult = 'blocked';
  } else if (warningCount > 0) {
    finalEvalResult = 'warning';
  } else {
    finalEvalResult = 'passed';
  }

  // 8. Persist findings
  for (const f of finalFindings) {
    await client.query(
      `INSERT INTO compliance_findings (
         id, workspace_id, evaluation_id, fingerprint, code, severity, source,
         video_number, field_path, message, evidence_ids_json, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
       ON CONFLICT (workspace_id, evaluation_id, fingerprint) DO NOTHING`,
      [
        generateUuidV7(),
        workspaceId,
        evaluationId,
        Buffer.from(f.fingerprint, 'hex'),
        f.code,
        f.severity,
        f.source,
        f.videoNumber,
        f.fieldPath,
        f.message,
        JSON.stringify(f.evidenceIds),
      ],
    );
  }

  // 9. Persist compliance_report artifact revision
  const { reportArtifactId, reportRevNum } = await findOrCreateReportArtifact(
    client,
    workspaceId,
    productId,
    workOrderId,
    job.work_item_id,
  );

  const reportContent: ComplianceReportContent = {
    schemaVersion: 1,
    policyVersion,
    policyHash: deterministicResult.policyHash,
    scriptArtifactId: artifactId,
    scriptRevisionNumber: revisionNumber,
    scriptContentHash: contentHashHex,
    result: finalEvalResult,
    blockingCount,
    warningCount,
    infoCount,
    deterministicPassed: deterministicResult.passed,
    aiAdvisoryStatus: 'completed',
    findings: finalFindings,
    summary:
      finalEvalResult === 'blocked'
        ? `Gói kịch bản bị chặn do phát hiện ${blockingCount} vi phạm quy tắc tuân thủ nghiêm ngặt.`
        : finalEvalResult === 'warning'
          ? `Gói kịch bản đạt yêu cầu cơ bản nhưng có ${warningCount} cảnh báo cần lưu ý.`
          : 'Gói kịch bản hoàn toàn tuân thủ các quy tắc quảng cáo và tiếp thị liên kết.',
    evaluatedAt: new Date().toISOString(),
  };

  const reportHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(reportContent), 'utf8').digest(),
  );

  await client.query(
    `INSERT INTO content_artifact_revisions (
       id, workspace_id, artifact_id, revision_number, content_json,
       content_hash, schema_version, prompt_template, prompt_version,
       provider, model, token_input, token_output, cost_microunits,
       cost_currency, latency_ms, author_role_key, created_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb,
       $6, 1, 'compliance_policy', $7,
       $8, $9, $10, $11, $12,
       'USD', $13, 'compliance_reviewer', NOW()
     )`,
    [
      generateUuidV7(),
      workspaceId,
      reportArtifactId,
      reportRevNum,
      JSON.stringify(reportContent),
      Buffer.from(reportHash),
      policyVersion,
      advisoryRes.provenance.provider,
      advisoryRes.provenance.model,
      advisoryRes.usage.tokenInput ?? 0,
      advisoryRes.usage.tokenOutput ?? 0,
      actualSpend,
      advisoryRes.usage.latencyMs ?? 0,
    ],
  );

  // 10. Settle evaluation with exact report binding
  const evalUpdateRes = await client.query(
    `UPDATE compliance_evaluations
     SET status = 'completed',
         result = $1,
         blocking_count = $2,
         warning_count = $3,
         info_count = $4,
         deterministic_passed = $5,
         ai_advisory_status = 'completed',
         evaluation_report_artifact_id = $6,
         evaluation_report_revision_number = $7,
         evaluation_report_content_hash = $8,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $9 AND workspace_id = $10 AND status IN ('queued', 'running')`,
    [
      finalEvalResult,
      blockingCount,
      warningCount,
      infoCount,
      deterministicResult.passed,
      reportArtifactId,
      reportRevNum,
      Buffer.from(reportHash),
      evaluationId,
      workspaceId,
    ],
  );
  if (evalUpdateRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update compliance_evaluations ${evaluationId}`);
  }

  // 11. Settle operation, AI run, job execution
  const resultLocation = `/artifacts/${reportArtifactId}/revisions/${reportRevNum}`;
  const opRes = await client.query(
    `UPDATE operations
     SET status = 'succeeded', progress_percent = 100, result_location = $1,
         started_at = COALESCE(started_at, NOW()), completed_at = NOW(),
         error_category = NULL, error_code = NULL, error_message = NULL,
         updated_at = NOW(), version = version + 1
     WHERE id = $2 AND workspace_id = $3 AND status IN ('queued', 'running')`,
    [resultLocation, operationId, workspaceId],
  );
  if (opRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update operations ${operationId}`);
  }

  const runRes = await client.query(
    `UPDATE ai_runs
     SET status = 'succeeded', provider = $1, model = $2,
         prompt_template = $3, prompt_version = $4, output_hash = $5,
         token_input = $6, token_output = $7, cost_microunits = $8,
         cost_currency = $9, latency_ms = $10, started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(), error_category = NULL, updated_at = NOW(), version = version + 1
     WHERE id = $11 AND workspace_id = $12 AND status IN ('queued', 'running')`,
    [
      advisoryRes.provenance.provider,
      advisoryRes.provenance.model,
      advisoryRes.provenance.promptTemplate,
      advisoryRes.provenance.promptVersion,
      Buffer.from(reportHash),
      advisoryRes.usage.tokenInput ?? 0,
      advisoryRes.usage.tokenOutput ?? 0,
      actualSpend,
      advisoryRes.usage.costCurrency ?? 'USD',
      advisoryRes.usage.latencyMs ?? 0,
      aiRunId,
      workspaceId,
    ],
  );
  if (runRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to update ai_runs ${aiRunId}`);
  }

  const jobUpdateRes = await client.query(
    `UPDATE job_executions
     SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
         reserved_spend_microunits = 0,
         started_at = COALESCE(started_at, NOW()), completed_at = NOW(),
         last_error_category = NULL, updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2 AND status = 'running' AND lease_owner = $3 AND version = $4`,
    [jobId, workspaceId, workerId, jobVersion],
  );
  if (jobUpdateRes.rowCount !== 1) {
    throw new JobLeaseExpiredError(jobId);
  }

  // 12. Update work item & assignment
  if (job.work_item_id) {
    const itemRes = await client.query(
      `UPDATE work_items
       SET status = 'review_required', started_at = COALESCE(started_at, NOW()), completed_at = NULL, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [job.work_item_id, workspaceId],
    );
    if (itemRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to update work_items ${job.work_item_id}`);
    }

    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'review_required', updated_at = NOW(), version = version + 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND work_item_id = $3`,
      [workspaceId, workOrderId, job.work_item_id],
    );
  }

  return { status: 'completed', evaluationId };
}

async function findOrCreateReportArtifact(
  client: pg.PoolClient,
  workspaceId: string,
  productId: string,
  workOrderId: string,
  workItemId?: string | null,
): Promise<{ readonly reportArtifactId: string; readonly reportRevNum: number }> {
  const reportArtRes = await client.query(
    `SELECT id, current_revision_number FROM content_artifacts
     WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'compliance_report'
     FOR UPDATE`,
    [workspaceId, workOrderId],
  );

  let reportArtifactId: string;
  let reportRevNum = 1;

  if (reportArtRes.rowCount === 0 || !reportArtRes.rows[0]) {
    reportArtifactId = generateUuidV7();
    await client.query(
      `INSERT INTO content_artifacts (
         id, workspace_id, product_id, work_order_id, work_item_id, assignment_id,
         author_role_key, artifact_type, lifecycle_status, current_revision_number,
         created_at, updated_at, version
       ) VALUES (
         $1, $2, $3, $4, $5,
         (SELECT a.id FROM agent_assignments a
          JOIN agent_role_definitions r ON r.id = a.role_definition_id
          WHERE a.workspace_id = $2 AND a.work_order_id = $4 AND r.role_key = 'compliance_reviewer' LIMIT 1),
         'compliance_reviewer', 'compliance_report', 'review_required', 1,
         NOW(), NOW(), 1
       )`,
      [reportArtifactId, workspaceId, productId, workOrderId, workItemId ?? null],
    );
  } else {
    reportArtifactId = reportArtRes.rows[0].id;
    reportRevNum = Number(reportArtRes.rows[0].current_revision_number) + 1;
    await client.query(
      `UPDATE content_artifacts
       SET current_revision_number = $1, updated_at = NOW(), version = version + 1
       WHERE workspace_id = $2 AND id = $3`,
      [reportRevNum, workspaceId, reportArtifactId],
    );
  }

  return { reportArtifactId, reportRevNum };
}

export interface SettleComplianceMalformedJobParams {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly workerId?: string | undefined;
}

export async function settleComplianceMalformedJobAtomic(
  client: pg.PoolClient,
  params: SettleComplianceMalformedJobParams,
): Promise<void> {
  const { workspaceId, jobId } = params;

  // 1. Lock job execution row using ONLY trusted columns from the DB
  const jobRes = await client.query(
    `SELECT id, workspace_id, operation_id, ai_run_id, work_order_id, work_item_id,
            reserved_spend_microunits, status, version, lease_owner
     FROM job_executions
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [jobId, workspaceId],
  );

  if (jobRes.rowCount === 0 || !jobRes.rows[0]) {
    return;
  }
  const job = jobRes.rows[0];

  // If already terminal, nothing to clean up
  if (job.status === 'succeeded' || job.status === 'failed') {
    return;
  }

  // 2. Release any reserved budget exactly once
  const reservedSpend = Number(job.reserved_spend_microunits ?? 0);
  if (reservedSpend > 0) {
    const budgetRes = await client.query(
      `UPDATE workspace_ai_policies
       SET reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $1),
           updated_at = NOW(),
           version = version + 1
       WHERE workspace_id = $2`,
      [reservedSpend, workspaceId],
    );
    if (budgetRes.rowCount !== 1) {
      throw new DatabaseError(`Failed to release budget reservation for workspace ${workspaceId}`);
    }
  }

  // 3. Mark job_executions as failed, clear lease & reservation
  await client.query(
    `UPDATE job_executions
     SET status = 'failed',
         last_error_category = 'internal_error',
         lease_owner = NULL,
         lease_expires_at = NULL,
         reserved_spend_microunits = 0,
         completed_at = NOW(),
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [jobId, workspaceId],
  );

  // 4. Mark linked operations row as failed
  if (job.operation_id) {
    await client.query(
      `UPDATE operations
       SET status = 'failed',
           error_category = 'internal_error',
           error_code = 'MALFORMED_JOB_PAYLOAD',
           error_message = 'Job payload is malformed or invalid',
           completed_at = NOW(),
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [job.operation_id, workspaceId],
    );
  }

  // 5. Mark linked ai_runs row as failed
  if (job.ai_run_id) {
    await client.query(
      `UPDATE ai_runs
       SET status = 'failed',
           error_category = 'internal_error',
           completed_at = NOW(),
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [job.ai_run_id, workspaceId],
    );
  }

  // 6. Mark any linked compliance_evaluations row as failed
  await client.query(
    `UPDATE compliance_evaluations
     SET status = 'failed',
         result = 'failed',
         ai_advisory_status = 'failed',
         evaluation_report_artifact_id = NULL,
         evaluation_report_revision_number = NULL,
         evaluation_report_content_hash = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE job_id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
    [jobId, workspaceId],
  );

  // 7. Work item & assignment
  if (job.work_item_id) {
    await client.query(
      `UPDATE work_items
       SET status = 'failed',
           completed_at = NOW(),
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')`,
      [job.work_item_id, workspaceId],
    );

    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'failed',
           updated_at = NOW(),
           version = version + 1
       WHERE workspace_id = $1 AND work_item_id = $2 AND office_state = 'queued'`,
      [workspaceId, job.work_item_id],
    );
  }
}
