import crypto from 'node:crypto';
import type pg from 'pg';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type AcceptScriptRevisionParams,
  type AcceptScriptRevisionResult,
  type ContentApprovalSnapshotDTO,
  type ContentReviewDecisionDTO,
  ArtifactNotFoundError,
  ArtifactRevisionConflictError,
  ChiefOfStaffAssignmentConflictError,
  ComplianceBlockingFindingsError,
  ComplianceEvaluationNotApprovableError,
  ComplianceEvaluationNotFoundError,
  ComplianceEvaluationStaleError,
  ContentReviewDecisionConflictError,
  WorkOrderStateConflictError,
} from '@affiliate-content-os/application';
import {
  CURRENT_COMPLIANCE_POLICY_VERSION,
  computeCompliancePolicyHash,
  parseIsoTimestamp,
  type ComplianceReportContent,
} from '@affiliate-content-os/domain';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { getArtifactRevisionByNumberQuery } from './workforce-revision-queries.js';

export async function acceptScriptRevisionTransaction(
  client: pg.PoolClient,
  params: AcceptScriptRevisionParams,
): Promise<AcceptScriptRevisionResult> {
  const {
    workspaceId,
    artifactId,
    actorUserId,
    expectedVersion,
    revisionNumber,
    contentHashHex,
    note,
    idempotency,
  } = params;

  // 1. Transaction-scoped advisory lock on idempotency key
  const lockKey = computeIdempotencyAdvisoryLockKey(
    actorUserId,
    idempotency.routeKey,
    idempotency.keyHash,
  );
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

  // 2. Check existing idempotency key
  const idempCheck = await client.query<RawIdempotencyRow>(
    `SELECT id, workspace_id, principal_id, route_key, key_hash, request_hash,
            status_code, response_json, resource_type, resource_id, expires_at, created_at
     FROM idempotency_keys
     WHERE workspace_id = $1 AND principal_id = $2 AND route_key = $3 AND key_hash = $4
     FOR UPDATE`,
    [workspaceId, actorUserId, idempotency.routeKey, Buffer.from(idempotency.keyHash)],
  );

  if (idempCheck.rowCount !== 0 && idempCheck.rows[0]) {
    const rawRow = idempCheck.rows[0];
    const snapshot = validateAndMapIdempotencyRow(rawRow);

    const txTimeRes = await client.query<{ now: Date | string }>(
      'SELECT transaction_timestamp() AS now',
    );
    const rawTxTime = txTimeRes.rows[0]?.now;
    const txTimeMs =
      rawTxTime instanceof Date ? rawTxTime.getTime() : Date.parse(String(rawTxTime));
    const isExpired = Date.parse(snapshot.expiresAt) <= txTimeMs;

    if (isExpired) {
      await client.query('DELETE FROM idempotency_keys WHERE id = $1', [snapshot.id]);
    } else {
      if (
        snapshot.requestHash.byteLength !== idempotency.requestHash.byteLength ||
        !crypto.timingSafeEqual(snapshot.requestHash, idempotency.requestHash)
      ) {
        throw new IdempotencyKeyReusedError();
      }

      return snapshot.responseJson as unknown as AcceptScriptRevisionResult;
    }
  }

  // 3. Prevent conflicting terminal human decisions for the same exact revision
  const existingDecRes = await client.query(
    `SELECT id, decision
     FROM content_review_decisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3 AND decision IN ('accept', 'reject')
     FOR UPDATE`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (existingDecRes.rowCount !== 0 && existingDecRes.rows[0]) {
    throw new ContentReviewDecisionConflictError(
      `Revision ${revisionNumber} has already received terminal decision "${existingDecRes.rows[0].decision}" and cannot receive another terminal decision.`,
    );
  }

  // 4. Fetch artifact with optimistic lock
  const artRes = await client.query(
    `SELECT id, product_id, work_order_id, work_item_id, assignment_id,
            author_role_key, artifact_type, lifecycle_status,
            current_revision_number, version
     FROM content_artifacts
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [workspaceId, artifactId],
  );

  if (artRes.rowCount === 0 || !artRes.rows[0]) {
    throw new ArtifactNotFoundError(artifactId);
  }
  const art = artRes.rows[0];

  if (art.artifact_type !== 'script_package') {
    throw new ArtifactRevisionConflictError(`Cannot accept artifact type ${art.artifact_type}`);
  }
  if (art.lifecycle_status !== 'review_required') {
    throw new ArtifactRevisionConflictError(
      `Precondition failed: artifact is in "${art.lifecycle_status}" lifecycle status, expected "review_required"`,
    );
  }
  if (Number(art.version) !== expectedVersion) {
    throw new ArtifactRevisionConflictError(
      `Precondition failed: artifact version mismatch (expected ${expectedVersion}, current ${art.version})`,
    );
  }
  if (Number(art.current_revision_number) !== revisionNumber) {
    throw new ArtifactRevisionConflictError(
      `Precondition failed: artifact revision mismatch (expected ${revisionNumber}, current ${art.current_revision_number})`,
    );
  }

  // 5. Fetch revision and verify content hash
  const revRes = await client.query(
    `SELECT content_json, content_hash, schema_version
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (revRes.rowCount === 0 || !revRes.rows[0]) {
    throw new ArtifactRevisionConflictError(`Revision ${revisionNumber} not found`);
  }
  const actualHashHex = Buffer.from(revRes.rows[0].content_hash).toString('hex');
  if (actualHashHex.toLowerCase() !== contentHashHex.toLowerCase()) {
    throw new ArtifactRevisionConflictError('Precondition failed: content hash mismatch');
  }

  // 6. Fetch completed compliance evaluation matching current policy version and policy hash
  const currentPolicyVersion = CURRENT_COMPLIANCE_POLICY_VERSION;
  const currentPolicyHashHex = computeCompliancePolicyHash(currentPolicyVersion);
  const currentPolicyHash = Buffer.from(currentPolicyHashHex, 'hex');

  const evalRes = await client.query(
    `SELECT id, status, result, blocking_count, warning_count, info_count, deterministic_passed, ai_advisory_status,
            policy_version, policy_hash, evaluation_report_artifact_id,
            evaluation_report_revision_number, evaluation_report_content_hash,
            script_content_hash, context_package_id
     FROM compliance_evaluations
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3
       AND policy_version = $4 AND policy_hash = $5
     FOR UPDATE`,
    [workspaceId, artifactId, revisionNumber, currentPolicyVersion, currentPolicyHash],
  );

  if (evalRes.rowCount === 0 || !evalRes.rows[0]) {
    throw new ComplianceEvaluationNotFoundError(
      `Precondition failed: no compliance evaluation found for revision ${revisionNumber} under current policy ${currentPolicyVersion}`,
    );
  }
  const evalRow = evalRes.rows[0];

  if (evalRow.status !== 'completed') {
    throw new ComplianceEvaluationNotApprovableError(`evaluation is currently ${evalRow.status}`);
  }
  if (evalRow.result === 'failed') {
    throw new ComplianceEvaluationNotApprovableError('compliance evaluation resulted in failure');
  }
  if (evalRow.result === 'blocked' || Number(evalRow.blocking_count) > 0) {
    throw new ComplianceBlockingFindingsError(Number(evalRow.blocking_count));
  }
  if (evalRow.ai_advisory_status === 'failed') {
    throw new ComplianceEvaluationNotApprovableError('AI advisory review failed');
  }
  if (
    !evalRow.evaluation_report_artifact_id ||
    evalRow.evaluation_report_revision_number == null ||
    !evalRow.evaluation_report_content_hash
  ) {
    throw new ComplianceEvaluationNotApprovableError('compliance report binding missing');
  }

  // Verify script content hash bound in evaluation matches actual revision content hash
  const evalScriptHashHex = Buffer.from(evalRow.script_content_hash).toString('hex');
  if (evalScriptHashHex.toLowerCase() !== actualHashHex.toLowerCase()) {
    throw new ComplianceEvaluationStaleError(
      `Evaluation was performed against script content hash ${evalScriptHashHex}, current is ${actualHashHex}`,
    );
  }

  // Double-check policy drift
  const evalHashHex = Buffer.from(evalRow.policy_hash).toString('hex');
  if (
    evalRow.policy_version !== currentPolicyVersion ||
    evalHashHex.toLowerCase() !== currentPolicyHashHex.toLowerCase()
  ) {
    throw new ComplianceEvaluationStaleError(
      'Evaluation policy version or hash does not match current code policy',
    );
  }

  // Verify compliance report artifact container exists and has not advanced past the evaluation's report revision
  const reportCheck = await client.query(
    `SELECT id, current_revision_number
     FROM content_artifacts
     WHERE workspace_id = $1 AND id = $2 AND artifact_type = 'compliance_report'`,
    [workspaceId, evalRow.evaluation_report_artifact_id],
  );
  if (reportCheck.rowCount === 0 || !reportCheck.rows[0]) {
    throw new ComplianceEvaluationNotApprovableError(
      'immutable compliance report artifact not found',
    );
  }
  if (
    Number(reportCheck.rows[0].current_revision_number) !==
    Number(evalRow.evaluation_report_revision_number)
  ) {
    throw new ComplianceEvaluationStaleError(
      `Compliance report artifact container has advanced to revision ${reportCheck.rows[0].current_revision_number}, evaluation is bound to revision ${evalRow.evaluation_report_revision_number}`,
    );
  }

  // Load exact immutable report revision
  const reportRevRes = await client.query(
    `SELECT id, content_json, content_hash
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, evalRow.evaluation_report_artifact_id, evalRow.evaluation_report_revision_number],
  );
  if (reportRevRes.rowCount === 0 || !reportRevRes.rows[0]) {
    throw new ComplianceEvaluationNotApprovableError(
      'immutable compliance report revision not found',
    );
  }
  const reportRev = reportRevRes.rows[0];
  const actualReportHashHex = Buffer.from(reportRev.content_hash).toString('hex');
  const expectedReportHashHex = Buffer.from(evalRow.evaluation_report_content_hash).toString('hex');
  if (actualReportHashHex.toLowerCase() !== expectedReportHashHex.toLowerCase()) {
    throw new ComplianceEvaluationNotApprovableError(
      'compliance report revision content hash mismatch with evaluation',
    );
  }

  const reportContent = reportRev.content_json as ComplianceReportContent;
  if (
    !reportContent ||
    reportContent.scriptArtifactId !== artifactId ||
    reportContent.scriptRevisionNumber !== revisionNumber ||
    (reportContent.scriptContentHash &&
      reportContent.scriptContentHash.toLowerCase() !== actualHashHex.toLowerCase()) ||
    reportContent.policyVersion !== currentPolicyVersion ||
    (reportContent.policyHash &&
      reportContent.policyHash.toLowerCase() !== currentPolicyHashHex.toLowerCase()) ||
    reportContent.result !== evalRow.result ||
    reportContent.blockingCount !== Number(evalRow.blocking_count) ||
    reportContent.warningCount !== Number(evalRow.warning_count) ||
    reportContent.infoCount !== Number(evalRow.info_count) ||
    reportContent.deterministicPassed !== Boolean(evalRow.deterministic_passed) ||
    reportContent.aiAdvisoryStatus !== evalRow.ai_advisory_status
  ) {
    throw new ComplianceEvaluationNotApprovableError(
      'compliance report content does not match evaluation contract',
    );
  }

  // Revalidate authoritative freshness: lineage brief, planning revisions, context package and evidence
  const lineageRes = await client.query(
    `SELECT content_brief_hash, content_brief_version, planning_revision_ids_json
     FROM content_artifact_lineage
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (lineageRes.rowCount === 0 || !lineageRes.rows[0]) {
    throw new ComplianceEvaluationStaleError(
      `Lineage not found for script revision ${revisionNumber}`,
    );
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

  const briefRes = await client.query(
    `SELECT brief_hash, brief_version
     FROM content_briefs
     WHERE workspace_id = $1 AND work_order_id = $2
     ORDER BY brief_version DESC LIMIT 1`,
    [workspaceId, art.work_order_id],
  );
  if (briefRes.rowCount === 0 || !briefRes.rows[0]) {
    throw new ComplianceEvaluationStaleError(
      `Content brief not found for work order ${art.work_order_id}`,
    );
  }
  const actualBriefHashHex = Buffer.from(briefRes.rows[0].brief_hash).toString('hex');
  if (expectedBriefHashHex.toLowerCase() !== actualBriefHashHex.toLowerCase()) {
    throw new ComplianceEvaluationStaleError(
      'Authoritative content brief has drifted from script lineage',
    );
  }

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
    [workspaceId, art.work_order_id, art.product_id],
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
    throw new ComplianceEvaluationStaleError(
      'Authoritative planning revisions have drifted from script lineage',
    );
  }

  const woRes = await client.query(
    `SELECT context_package_id FROM work_orders WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, art.work_order_id],
  );
  if (woRes.rowCount === 0 || !woRes.rows[0]) {
    throw new ComplianceEvaluationStaleError(`Work order ${art.work_order_id} not found`);
  }
  const contextPackageId = woRes.rows[0].context_package_id;

  if (evalRow.context_package_id !== contextPackageId) {
    throw new ComplianceEvaluationStaleError(
      `Evaluation was performed against context package ${evalRow.context_package_id}, but current work order context package is ${contextPackageId}`,
    );
  }

  const allowedFactsRes = await client.query(
    `SELECT f.id
     FROM product_facts f
     JOIN context_packages cp ON cp.fact_set_id = f.fact_set_id AND cp.workspace_id = f.workspace_id
     WHERE cp.workspace_id = $1 AND cp.id = $2 AND f.confidence = 'confirmed' AND f.claim_usage = 'allowed'`,
    [workspaceId, contextPackageId],
  );
  const allowedFactIdSet = new Set(allowedFactsRes.rows.map((r) => r.id));

  const allowedAnalysesRes = await client.query(
    `SELECT cpa.analysis_id AS id
     FROM context_package_analyses cpa
     JOIN analyses a ON a.id = cpa.analysis_id AND a.workspace_id = cpa.workspace_id
     WHERE cpa.workspace_id = $1 AND cpa.context_package_id = $2 AND a.status = 'accepted'`,
    [workspaceId, contextPackageId],
  );
  const allowedAnalysisIdSet = new Set(allowedAnalysesRes.rows.map((r) => r.id));

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
  const revokedEvidenceIdSet = new Set(revokedRes.rows.map((r) => r.id));

  // Extract disclosure state and check video evidence
  const scriptPkg = revRes.rows[0].content_json;
  const videos = Array.isArray(scriptPkg?.videos) ? scriptPkg.videos : [];

  for (const v of videos) {
    const videoRefs = Array.isArray(v.evidenceReferences) ? v.evidenceReferences : [];
    for (const ref of videoRefs) {
      const eid = ref.sourceId;
      if (revokedEvidenceIdSet.has(eid)) {
        throw new ComplianceEvaluationStaleError(
          `Evidence ${eid} referenced in video ${v.videoNumber} has been revoked or disallowed`,
        );
      }
      const isAllowed =
        ref.sourceKind === 'product_fact'
          ? allowedFactIdSet.has(eid)
          : ref.sourceKind === 'analysis'
            ? allowedAnalysisIdSet.has(eid)
            : false;
      if (!isAllowed) {
        throw new ComplianceEvaluationStaleError(
          `Evidence ${eid} referenced in video ${v.videoNumber} is no longer in allowed context package`,
        );
      }
    }
  }

  const pkgEvidenceRefs = Array.isArray(scriptPkg?.evidenceReferences)
    ? scriptPkg.evidenceReferences
    : [];
  for (const ref of pkgEvidenceRefs) {
    const eid = ref.sourceId;
    if (revokedEvidenceIdSet.has(eid)) {
      throw new ComplianceEvaluationStaleError(
        `Package evidence ${eid} has been revoked or disallowed`,
      );
    }
    const isAllowed =
      ref.sourceKind === 'product_fact'
        ? allowedFactIdSet.has(eid)
        : ref.sourceKind === 'analysis'
          ? allowedAnalysisIdSet.has(eid)
          : false;
    if (!isAllowed) {
      throw new ComplianceEvaluationStaleError(
        `Package evidence ${eid} is no longer in allowed context package`,
      );
    }
  }

  for (const f of reportContent.findings ?? []) {
    for (const eid of f.evidenceIds ?? []) {
      if (revokedEvidenceIdSet.has(eid)) {
        throw new ComplianceEvaluationStaleError(
          `Evidence ${eid} referenced in report findings has been revoked`,
        );
      }
    }
  }

  // 7. Fetch evidence references for snapshot and verify freshness
  const evidenceRes = await client.query(
    `SELECT source_kind, source_id
     FROM artifact_evidence_refs
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  for (const ref of evidenceRes.rows) {
    if (revokedEvidenceIdSet.has(ref.source_id)) {
      throw new ComplianceEvaluationStaleError(
        `Referenced evidence ${ref.source_id} has been revoked or disallowed`,
      );
    }
    const isAllowed =
      ref.source_kind === 'product_fact'
        ? allowedFactIdSet.has(ref.source_id)
        : ref.source_kind === 'analysis'
          ? allowedAnalysisIdSet.has(ref.source_id)
          : false;
    if (!isAllowed) {
      throw new ComplianceEvaluationStaleError(
        `Referenced evidence ${ref.source_id} is no longer in allowed context package`,
      );
    }
  }
  const evidenceIds = evidenceRes.rows.map((r) => r.source_id);

  const disclosureState = {
    disclosures: videos.map((v: { videoNumber?: number; disclosure?: unknown }) => ({
      videoNumber: v.videoNumber,
      disclosure: v.disclosure,
    })),
  };

  // 8. Insert human decision record into content_review_decisions
  const decisionId = generateUuidV7();
  await client.query(
    `INSERT INTO content_review_decisions (
       id, workspace_id, artifact_id, revision_number, content_hash,
       evaluation_id, decision, actor_user_id, reason, metadata_json, created_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, 'accept', $7, $8, $9::jsonb, NOW()
     )`,
    [
      decisionId,
      workspaceId,
      artifactId,
      revisionNumber,
      Buffer.from(actualHashHex, 'hex'),
      evalRow.id,
      actorUserId,
      note ?? null,
      JSON.stringify({
        policyVersion: evalRow.policy_version,
        policyHash: Buffer.from(evalRow.policy_hash).toString('hex'),
      }),
    ],
  );

  // 9. Create immutable approval snapshot in content_approval_snapshots
  const snapshotId = generateUuidV7();
  const snapshotJson = {
    artifactId,
    revisionNumber,
    contentHashHex: actualHashHex,
    content: scriptPkg,
    evaluationId: evalRow.id,
    contextPackageId: evalRow.context_package_id,
    policyVersion: evalRow.policy_version,
    policyHashHex: Buffer.from(evalRow.policy_hash).toString('hex'),
    decisionId,
    approvedByUserId: actorUserId,
    evidenceIds,
    disclosureState,
    note: note ?? null,
    approvedAt: new Date().toISOString(),
  };

  const snapshotHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(snapshotJson), 'utf8').digest(),
  );

  await client.query(
    `INSERT INTO content_approval_snapshots (
       id, workspace_id, artifact_id, revision_number, content_hash,
       evaluation_id, policy_version, policy_hash, decision_id, approved_by_user_id,
       evidence_ids_json, disclosure_state_json, snapshot_json, snapshot_hash, created_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11::jsonb, $12::jsonb, $13::jsonb, $14, NOW()
     )`,
    [
      snapshotId,
      workspaceId,
      artifactId,
      revisionNumber,
      Buffer.from(actualHashHex, 'hex'),
      evalRow.id,
      evalRow.policy_version,
      evalRow.policy_hash,
      decisionId,
      actorUserId,
      JSON.stringify(evidenceIds),
      JSON.stringify(disclosureState),
      JSON.stringify(snapshotJson),
      Buffer.from(snapshotHash),
    ],
  );

  // 10. Update artifact lifecycle to 'accepted' with precondition checks
  const updateArtRes = await client.query(
    `UPDATE content_artifacts
     SET lifecycle_status = 'accepted', version = version + 1, updated_at = NOW()
     WHERE workspace_id = $1 AND id = $2 AND version = $3 AND current_revision_number = $4 AND lifecycle_status = 'review_required'`,
    [workspaceId, artifactId, art.version, revisionNumber],
  );
  if (updateArtRes.rowCount !== 1) {
    throw new ArtifactRevisionConflictError(
      'Precondition failed: artifact state conflict during acceptance',
    );
  }

  // 11. Complete work order handoff state with precondition checks
  const updateWoRes = await client.query(
    `UPDATE work_orders
     SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW(), version = version + 1
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, art.work_order_id],
  );
  if (updateWoRes.rowCount !== 1) {
    throw new WorkOrderStateConflictError(
      'Precondition failed: work order state conflict during acceptance',
    );
  }

  const updateCosRes = await client.query(
    `UPDATE agent_assignments a
     SET office_state = 'completed', updated_at = NOW(), version = a.version + 1
     FROM agent_role_definitions r
     WHERE a.role_definition_id = r.id
       AND a.workspace_id = $1
       AND a.work_order_id = $2
       AND r.role_key = 'chief_of_staff'`,
    [workspaceId, art.work_order_id],
  );
  if (updateCosRes.rowCount !== 1) {
    throw new ChiefOfStaffAssignmentConflictError(
      'Precondition failed: chief of staff assignment state conflict during acceptance',
    );
  }

  // 12. Write audit event
  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, changes_json, occurred_at, created_at
     ) VALUES (
       $1, $2, 'user', $3, 'artifact.accepted', 'content_artifact',
       $4, 'succeeded', $5::jsonb, NOW(), NOW()
     )`,
    [
      generateUuidV7(),
      workspaceId,
      actorUserId,
      artifactId,
      JSON.stringify({
        revisionNumber,
        contentHashHex: actualHashHex,
        decisionId,
        snapshotId,
        evaluationId: evalRow.id,
      }),
    ],
  );

  // 13. Build return DTOs
  const updatedDetail = await getArtifactRevisionByNumberQuery(
    client,
    workspaceId,
    artifactId,
    revisionNumber,
  );

  const decisionDTO: ContentReviewDecisionDTO = {
    id: decisionId,
    workspaceId,
    artifactId,
    revisionNumber,
    contentHashHex: actualHashHex,
    evaluationId: evalRow.id,
    decision: 'accept',
    actorUserId,
    reason: note ?? null,
    metadata: {
      policyVersion: evalRow.policy_version,
      policyHash: Buffer.from(evalRow.policy_hash).toString('hex'),
    },
    createdAt: parseIsoTimestamp(new Date().toISOString()),
  };

  const snapshotDTO: ContentApprovalSnapshotDTO = {
    id: snapshotId,
    workspaceId,
    artifactId,
    revisionNumber,
    contentHashHex: actualHashHex,
    evaluationId: evalRow.id,
    policyVersion: evalRow.policy_version,
    policyHashHex: Buffer.from(evalRow.policy_hash).toString('hex'),
    decisionId,
    approvedByUserId: actorUserId,
    evidenceIds,
    disclosureState,
    snapshot: snapshotJson,
    snapshotHashHex: Buffer.from(snapshotHash).toString('hex'),
    createdAt: parseIsoTimestamp(new Date().toISOString()),
  };

  const responseResult: AcceptScriptRevisionResult = {
    artifact: updatedDetail!,
    decision: decisionDTO,
    approvalSnapshot: snapshotDTO,
  };

  // 14. Persist idempotency cache
  await client.query(
    `INSERT INTO idempotency_keys (
       id, workspace_id, principal_id, route_key, key_hash, request_hash,
       status_code, response_json, resource_type, resource_id, expires_at, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       200, $7::jsonb, 'content_artifact', $8,
       NOW() + INTERVAL '24 hours', NOW()
     )`,
    [
      generateUuidV7(),
      workspaceId,
      actorUserId,
      idempotency.routeKey,
      Buffer.from(idempotency.keyHash),
      Buffer.from(idempotency.requestHash),
      JSON.stringify(responseResult),
      artifactId,
    ],
  );

  return responseResult;
}
