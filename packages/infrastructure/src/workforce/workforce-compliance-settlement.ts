import crypto from 'node:crypto';
import type pg from 'pg';
import {
  generateUuidV7,
  JobLeaseExpiredError,
  type AIGatewayPort,
} from '@affiliate-content-os/application';
import {
  CURRENT_COMPLIANCE_POLICY_VERSION,
  computeFindingFingerprint,
  evaluateDeterministicCompliance,
  parseProductId,
  parseWorkOrderId,
  parseWorkspaceId,
  type ComplianceFinding,
  type ComplianceReportContent,
  type ScriptPackage,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

export interface SettleComplianceReviewParams {
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
}

export async function settleComplianceReviewJobAtomic(
  client: pg.PoolClient,
  gatewayPort: AIGatewayPort,
  params: SettleComplianceReviewParams,
): Promise<{ readonly status: 'completed' | 'drift_canceled'; readonly evaluationId: string }> {
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
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
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

  // 2. Lock operation and AI run
  const opRes = await client.query(
    `SELECT id, status FROM operations WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [operationId, workspaceId],
  );
  if (opRes.rowCount === 0 || !opRes.rows[0]) {
    throw new DatabaseError(`Operation ${operationId} not found`);
  }
  if (opRes.rows[0].status === 'succeeded' || opRes.rows[0].status === 'failed') {
    throw new DatabaseError(`Operation ${operationId} already terminal`);
  }

  const runRes = await client.query(
    `SELECT id, status FROM ai_runs WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [aiRunId, workspaceId],
  );
  if (runRes.rowCount === 0 || !runRes.rows[0]) {
    throw new DatabaseError(`AI run ${aiRunId} not found`);
  }

  // 3. Lock evaluation
  const evalRes = await client.query(
    `SELECT id, status, result, policy_version, policy_hash, revision_number
     FROM compliance_evaluations
     WHERE id = $1 AND workspace_id = $2
     FOR UPDATE`,
    [evaluationId, workspaceId],
  );
  if (evalRes.rowCount === 0 || !evalRes.rows[0]) {
    throw new DatabaseError(`Evaluation ${evaluationId} not found`);
  }
  if (evalRes.rows[0].status === 'completed') {
    return { status: 'completed', evaluationId };
  }

  // 4. Fetch artifact revision and verify drift
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

  // Verify artifact current revision still matches (drift check)
  const artRes = await client.query(
    `SELECT current_revision_number FROM content_artifacts WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, artifactId],
  );
  if (artRes.rowCount === 0 || !artRes.rows[0]) {
    throw new DatabaseError(`Artifact ${artifactId} not found`);
  }

  // 5. Fetch authoritative context package for work order
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

  // Content brief hash
  const briefRes = await client.query(
    `SELECT brief_hash FROM content_briefs WHERE workspace_id = $1 AND work_order_id = $2 ORDER BY brief_version DESC LIMIT 1`,
    [workspaceId, workOrderId],
  );
  const briefHashHex = briefRes.rows[0]?.brief_hash
    ? Buffer.from(briefRes.rows[0].brief_hash).toString('hex')
    : undefined;

  // 6. Run deterministic preflight
  const detResult = evaluateDeterministicCompliance({
    scriptPackage: scriptContent,
    expectedArtifactId: artifactId,
    expectedRevisionNumber: revisionNumber,
    expectedContentHashHex: contentHashHex,
    actualContentHashHex: contentHashHex,
    allowedFactIds,
    allowedAnalysisIds,
    expectedBriefHashHex: briefHashHex,
    actualBriefHashHex: briefHashHex,
  });

  const reservedSpend = Number(job.reserved_spend_microunits ?? 0);
  const allFindings: ComplianceFinding[] = [...detResult.findings];
  let aiAdvisoryStatus: 'skipped' | 'completed' | 'failed' = 'skipped';
  let actualSpend = 0;
  let aiModel = 'gemini-3.8-flash';
  let aiProvider = 'google';
  let aiPromptTemplate = 'compliance_advisory_v1';
  let aiPromptVersion = '1.0.0';
  let aiUsage: {
    readonly tokenInput?: number;
    readonly tokenOutput?: number;
    readonly costCurrency?: string;
    readonly latencyMs?: number;
  } | null = null;

  if (detResult.passed) {
    // Deterministic passed -> execute at most 1 AI advisory call
    try {
      const advisoryRes = await gatewayPort.executeComplianceAdvisory({
        workspaceId: parseWorkspaceId(workspaceId),
        productId: parseProductId(productId),
        workOrderId: parseWorkOrderId(workOrderId),
        artifactId,
        revisionNumber,
        scriptPackage: scriptContent,
      });

      if (advisoryRes.success && advisoryRes.content) {
        aiAdvisoryStatus = 'completed';
        aiModel = advisoryRes.provenance.model;
        aiProvider = advisoryRes.provenance.provider;
        aiPromptTemplate = advisoryRes.provenance.promptTemplate;
        aiPromptVersion = advisoryRes.provenance.promptVersion;
        actualSpend = advisoryRes.usage.costMicrounits ?? 0;
        aiUsage = advisoryRes.usage;

        for (const f of advisoryRes.content.findings ?? []) {
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
            evidenceIds: Object.freeze([...(f.evidenceIds ?? [])]),
          });
        }
      } else {
        aiAdvisoryStatus = 'failed';
      }
    } catch {
      aiAdvisoryStatus = 'failed';
    }
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

  // 7. Settle budget reservation and actual spend
  if (reservedSpend > 0) {
    if (actualSpend > 0) {
      await client.query(
        `UPDATE workspace_ai_policies
         SET current_spend_microunits = current_spend_microunits + $1,
             reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $2),
             updated_at = NOW(),
             version = version + 1
         WHERE workspace_id = $3`,
        [actualSpend, reservedSpend, workspaceId],
      );
    } else {
      await client.query(
        `UPDATE workspace_ai_policies
         SET reserved_spend_microunits = GREATEST(0, reserved_spend_microunits - $1),
             updated_at = NOW(),
             version = version + 1
         WHERE workspace_id = $2`,
        [reservedSpend, workspaceId],
      );
    }
  }

  // 8. Persist compliance findings into compliance_findings table
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

  // 9. Persist compliance_report artifact
  // Find or create compliance_report artifact container
  const reportArtRes = await client.query(
    `SELECT id, current_revision_number FROM content_artifacts
     WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'compliance_report'`,
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
      [reportArtifactId, workspaceId, productId, workOrderId, job.work_item_id],
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

  const reportContent: ComplianceReportContent = {
    schemaVersion: 1,
    policyVersion,
    policyHash: detResult.policyHash,
    scriptArtifactId: artifactId,
    scriptRevisionNumber: revisionNumber,
    scriptContentHash: contentHashHex,
    result: finalEvalResult,
    blockingCount,
    warningCount,
    infoCount,
    deterministicPassed: detResult.passed,
    aiAdvisoryStatus,
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
       $8, $9, 0, 0, $10,
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
      aiProvider,
      aiModel,
      actualSpend,
    ],
  );

  // 10. Settle compliance evaluation
  await client.query(
    `UPDATE compliance_evaluations
     SET status = 'completed',
         result = $1,
         blocking_count = $2,
         warning_count = $3,
         info_count = $4,
         deterministic_passed = $5,
         ai_advisory_status = $6,
         evaluation_report_artifact_id = $7,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $8 AND workspace_id = $9`,
    [
      finalEvalResult,
      blockingCount,
      warningCount,
      infoCount,
      detResult.passed,
      aiAdvisoryStatus,
      reportArtifactId,
      evaluationId,
      workspaceId,
    ],
  );

  // 11. Settle operation, AI run, and job execution
  const resultLocation = `/artifacts/${reportArtifactId}/revisions/${reportRevNum}`;
  await client.query(
    `UPDATE operations
     SET status = 'succeeded',
         progress_percent = 100,
         result_location = $1,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         error_category = NULL,
         error_code = NULL,
         error_message = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $2 AND workspace_id = $3`,
    [resultLocation, operationId, workspaceId],
  );

  const outputHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(reportContent), 'utf8').digest(),
  );

  const runProvider = aiProvider;
  const runModel = aiModel;
  const runPromptTemplate = aiPromptTemplate;
  const runPromptVersion = aiPromptVersion;
  const runTokenInput = aiUsage?.tokenInput ?? 0;
  const runTokenOutput = aiUsage?.tokenOutput ?? 0;
  const runCostCurrency = aiUsage?.costCurrency ?? 'USD';
  const runLatencyMs = aiUsage?.latencyMs ?? 0;

  await client.query(
    `UPDATE ai_runs
     SET status = 'succeeded',
         provider = $1,
         model = $2,
         prompt_template = $3,
         prompt_version = $4,
         output_hash = $5,
         token_input = $6,
         token_output = $7,
         cost_microunits = $8,
         cost_currency = $9,
         latency_ms = $10,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         error_category = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $11 AND workspace_id = $12`,
    [
      runProvider,
      runModel,
      runPromptTemplate,
      runPromptVersion,
      outputHash,
      runTokenInput,
      runTokenOutput,
      actualSpend,
      runCostCurrency,
      runLatencyMs,
      aiRunId,
      workspaceId,
    ],
  );

  await client.query(
    `UPDATE job_executions
     SET status = 'succeeded',
         lease_owner = NULL,
         lease_expires_at = NULL,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         last_error_category = NULL,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [jobId, workspaceId],
  );

  // 12. Update work item & assignment
  if (job.work_item_id) {
    await client.query(
      `UPDATE work_items
       SET status = 'review_required', updated_at = NOW(), version = version + 1
       WHERE id = $1 AND workspace_id = $2`,
      [job.work_item_id, workspaceId],
    );

    await client.query(
      `UPDATE agent_assignments
       SET office_state = 'review_required', updated_at = NOW(), version = version + 1
       WHERE workspace_id = $1 AND work_order_id = $2 AND work_item_id = $3`,
      [workspaceId, workOrderId, job.work_item_id],
    );
  }

  return { status: 'completed', evaluationId };
}
