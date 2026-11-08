import crypto from 'node:crypto';
import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import {
  validateScriptPackage,
  type ContentBrief,
  type ScriptPackage,
  type ScriptVideo,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

export async function assembleScriptPackageChangeRequestAtomic(
  client: pg.PoolClient,
  params: {
    readonly workspaceId: string;
    readonly changeRequestId: string;
  },
): Promise<boolean> {
  const { workspaceId, changeRequestId } = params;

  // 1. Fetch change request with row-level lock
  const crRes = await client.query(
    `SELECT id, artifact_id, base_revision_number, base_content_hash, selected_video_numbers,
            instruction_text, status
     FROM artifact_change_requests
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [workspaceId, changeRequestId],
  );

  if (crRes.rowCount === 0 || !crRes.rows[0]) {
    return false;
  }
  const cr = crRes.rows[0];
  if (cr.status === 'completed') {
    return true; // Already assembled (idempotent repeated call)
  }
  if (cr.status !== 'in_progress') {
    return false;
  }

  const artifactId = cr.artifact_id;
  const baseRevNum = Number(cr.base_revision_number);
  const expectedBaseHash = new Uint8Array(cr.base_content_hash);
  const selectedVideoNumbers = cr.selected_video_numbers as number[];

  // 2. Fetch succeeded units for this change request
  const unitsRes = await client.query(
    `SELECT id, video_number, output_json, brief_hash
     FROM script_generation_units
     WHERE workspace_id = $1 AND change_request_id = $2 AND status = 'succeeded'`,
    [workspaceId, changeRequestId],
  );

  if (unitsRes.rowCount !== selectedVideoNumbers.length) {
    return false;
  }

  // 3. Lock the artifact and check current revision
  const artRes = await client.query(
    `SELECT id, product_id, work_order_id, current_revision_number, version
     FROM content_artifacts
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [workspaceId, artifactId],
  );
  if (artRes.rowCount === 0 || !artRes.rows[0]) {
    throw new DatabaseError(`Artifact ${artifactId} not found`);
  }
  const art = artRes.rows[0];
  const productId = art.product_id;
  const workOrderId = art.work_order_id;
  const currentRevNum = Number(art.current_revision_number);

  // Fetch current revision content and hash
  const currentRevRes = await client.query(
    `SELECT content_hash, content_json
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, currentRevNum],
  );
  if (currentRevRes.rowCount === 0 || !currentRevRes.rows[0]) {
    throw new DatabaseError(
      `Current revision ${currentRevNum} not found for artifact ${artifactId}`,
    );
  }
  const currentRevHash = new Uint8Array(currentRevRes.rows[0].content_hash);

  // Stale base check: if a manual edit or another change request completed first, fail closed
  const isBaseStale =
    currentRevNum !== baseRevNum ||
    currentRevHash.byteLength !== expectedBaseHash.byteLength ||
    !crypto.timingSafeEqual(currentRevHash, expectedBaseHash);

  if (isBaseStale) {
    await client.query(
      `UPDATE artifact_change_requests
       SET status = 'failed',
           failure_reason = 'Stale base revision: artifact was updated by another revision prior to change request completion',
           updated_at = NOW(),
           version = version + 1
       WHERE workspace_id = $1 AND id = $2 AND status = 'in_progress'`,
      [workspaceId, changeRequestId],
    );
    return false;
  }

  // 4. Fetch content brief and verify authoritative context
  const briefRes = await client.query(
    `SELECT brief_json, brief_hash FROM content_briefs
     WHERE workspace_id = $1 AND work_order_id = $2
     ORDER BY brief_version DESC LIMIT 1`,
    [workspaceId, workOrderId],
  );
  if (briefRes.rowCount === 0 || !briefRes.rows[0]) {
    throw new DatabaseError(`Content brief not found for work order ${workOrderId}`);
  }
  const brief = briefRes.rows[0].brief_json as ContentBrief;
  const briefHash = new Uint8Array(briefRes.rows[0].brief_hash);

  // Verify every source unit used the exact identical brief hash
  for (const row of unitsRes.rows) {
    const rowHash = new Uint8Array(row.brief_hash);
    if (
      rowHash.byteLength !== briefHash.byteLength ||
      !crypto.timingSafeEqual(rowHash, briefHash)
    ) {
      throw new DatabaseError(`Brief hash mismatch on unit ${row.id}`);
    }
  }

  // Verify that the 3 planning artifact current revisions still match brief.planningRevisions
  const planningCheck = await client.query<{
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

  if (planningCheck.rowCount !== 3) {
    throw new DatabaseError(
      `Authoritative context drift: missing planning artifacts for work order ${workOrderId}`,
    );
  }

  const planningMap = new Map(planningCheck.rows.map((r) => [r.artifact_type, r]));
  const campaignRow = planningMap.get('product_campaign_plan');
  const audienceRow = planningMap.get('audience_insight_board');
  const seriesRow = planningMap.get('video_series_plan');

  if (
    !campaignRow ||
    campaignRow.current_revision_id !== brief.planningRevisions.productCampaignPlanRevisionId ||
    campaignRow.current_revision_number !==
      brief.planningRevisions.productCampaignPlanRevisionNumber ||
    !audienceRow ||
    audienceRow.current_revision_id !== brief.planningRevisions.audienceInsightBoardRevisionId ||
    audienceRow.current_revision_number !==
      brief.planningRevisions.audienceInsightBoardRevisionNumber ||
    !seriesRow ||
    seriesRow.current_revision_id !== brief.planningRevisions.videoSeriesPlanRevisionId ||
    seriesRow.current_revision_number !== brief.planningRevisions.videoSeriesPlanRevisionNumber
  ) {
    throw new DatabaseError(
      `Authoritative context drift: planning revisions changed after content brief synthesis for work order ${workOrderId}`,
    );
  }

  const baseContent = currentRevRes.rows[0].content_json as ScriptPackage;

  // Map replacement videos by videoNumber
  const replacementMap = new Map<
    number,
    { video: ScriptVideo; unitId: string; briefHash: Uint8Array }
  >();
  const sourceUnitIds: string[] = [];

  for (const row of unitsRes.rows) {
    const vNum = Number(row.video_number);
    const bHash = new Uint8Array(row.brief_hash);
    replacementMap.set(vNum, {
      video: row.output_json.video as ScriptVideo,
      unitId: row.id,
      briefHash: bHash,
    });
    sourceUnitIds.push(row.id);
  }

  // Merge videos
  const mergedVideos: ScriptVideo[] = [];
  for (let i = 0; i < 5; i++) {
    const vNum = i + 1;
    if (replacementMap.has(vNum)) {
      mergedVideos.push(replacementMap.get(vNum)!.video);
    } else {
      const baseVideo = baseContent.videos[i];
      if (!baseVideo) {
        throw new DatabaseError(`Base revision video at index ${i} not found`);
      }
      mergedVideos.push(baseVideo);
    }
  }

  const allEvidence = mergedVideos.flatMap((v) => v.evidenceReferences ?? []);
  const seenEv = new Set<string>();
  const dedupEvidence = allEvidence.filter((e) => {
    const k = `${e.sourceKind}:${e.sourceId}`;
    if (seenEv.has(k)) return false;
    seenEv.add(k);
    return true;
  });

  const newPkg: ScriptPackage = validateScriptPackage({
    schemaVersion: 1,
    seriesTitle: baseContent.seriesTitle,
    targetAudienceSummary: baseContent.targetAudienceSummary,
    creativeDirectionSummary: baseContent.creativeDirectionSummary,
    videos: mergedVideos,
    evidenceReferences: dedupEvidence,
  });

  const newHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(newPkg), 'utf8').digest(),
  );

  const newRevNum = currentRevNum + 1;
  const revId = generateUuidV7();

  // Query exact provider provenance from replacement units' ai_runs
  const aiRunsRes = await client.query<{
    provider: string;
    model: string;
    prompt_template: string;
    prompt_version: string;
    token_input: number | null;
    token_output: number | null;
    cost_microunits: string | number | null;
    cost_currency: string | null;
    latency_ms: number | null;
  }>(
    `SELECT r.provider, r.model, r.prompt_template, r.prompt_version,
            r.token_input, r.token_output, r.cost_microunits, r.cost_currency, r.latency_ms
     FROM script_generation_units u
     JOIN ai_runs r ON r.id = u.ai_run_id AND r.workspace_id = u.workspace_id
     WHERE u.workspace_id = $1 AND u.id = ANY($2::uuid[])`,
    [workspaceId, sourceUnitIds],
  );

  let totalTokenInput = 0;
  let totalTokenOutput = 0;
  let totalCostMicrounits = 0;
  let totalLatencyMs = 0;
  let provider = 'google';
  let model = 'gemini-3.8-flash';
  let promptTemplate = 'scriptwriting';
  let promptVersion = '1.0.0';
  let costCurrency = 'USD';

  for (const run of aiRunsRes.rows) {
    totalTokenInput += Number(run.token_input ?? 0);
    totalTokenOutput += Number(run.token_output ?? 0);
    totalCostMicrounits += Number(run.cost_microunits ?? 0);
    totalLatencyMs += Number(run.latency_ms ?? 0);
    if (run.provider) provider = run.provider;
    if (run.model) model = run.model;
    if (run.prompt_template) promptTemplate = run.prompt_template;
    if (run.prompt_version) promptVersion = run.prompt_version;
    if (run.cost_currency) costCurrency = run.cost_currency;
  }

  // 5. Insert new revision
  await client.query(
    `INSERT INTO content_artifact_revisions (
       id, workspace_id, artifact_id, revision_number, content_json,
       content_hash, schema_version, prompt_template, prompt_version,
       provider, model, token_input, token_output, cost_microunits,
       cost_currency, latency_ms, author_role_key, created_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb,
       $6, 1, $7, $8,
       $9, $10, $11, $12, $13,
       $14, $15, 'scriptwriter', NOW()
     )`,
    [
      revId,
      workspaceId,
      artifactId,
      newRevNum,
      JSON.stringify(newPkg),
      Buffer.from(newHash),
      promptTemplate,
      promptVersion,
      provider,
      model,
      totalTokenInput,
      totalTokenOutput,
      totalCostMicrounits,
      costCurrency,
      totalLatencyMs,
    ],
  );

  // 6. Insert evidence refs
  for (const ev of newPkg.evidenceReferences) {
    await client.query(
      `INSERT INTO artifact_evidence_refs (
         id, workspace_id, artifact_id, revision_number, source_kind, source_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (artifact_id, revision_number, source_kind, source_id) DO NOTHING`,
      [generateUuidV7(), workspaceId, artifactId, newRevNum, ev.sourceKind, ev.sourceId],
    );
  }

  // 7. Insert lineage with real planning revisions and actual unit metadata
  await client.query(
    `INSERT INTO content_artifact_lineage (
       id, workspace_id, artifact_id, revision_number, parent_revision_number,
       lineage_type, change_request_id, content_brief_hash, content_brief_version,
       planning_revision_ids_json, source_script_unit_ids_json, metadata_json, created_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       'change_request', $6, $7, 1,
       $8::jsonb, $9::jsonb, $10::jsonb, NOW()
     )`,
    [
      generateUuidV7(),
      workspaceId,
      artifactId,
      newRevNum,
      baseRevNum,
      changeRequestId,
      Buffer.from(briefHash),
      JSON.stringify(brief.planningRevisions),
      JSON.stringify(sourceUnitIds),
      JSON.stringify({
        instruction: cr.instruction_text,
        replacedVideos: selectedVideoNumbers,
        provenance: { provider, model, promptTemplate, promptVersion },
        usage: {
          tokenInput: totalTokenInput,
          tokenOutput: totalTokenOutput,
          costMicrounits: totalCostMicrounits,
          costCurrency,
          latencyMs: totalLatencyMs,
        },
      }),
    ],
  );

  // 8. Update artifact
  await client.query(
    `UPDATE content_artifacts
     SET current_revision_number = $1, version = version + 1, updated_at = NOW()
     WHERE workspace_id = $2 AND id = $3`,
    [newRevNum, workspaceId, artifactId],
  );

  // 9. Update change request to completed
  await client.query(
    `UPDATE artifact_change_requests
     SET status = 'completed', resulting_revision_number = $1, updated_at = NOW(), version = version + 1
     WHERE workspace_id = $2 AND id = $3`,
    [newRevNum, workspaceId, changeRequestId],
  );

  // 10. Update scriptwriter assignment to review_required
  await client.query(
    `UPDATE agent_assignments aa
     SET office_state = 'review_required', updated_at = NOW(), version = aa.version + 1
     FROM agent_role_definitions rd
     WHERE aa.role_definition_id = rd.id
       AND aa.workspace_id = $1
       AND aa.work_order_id = $2
       AND rd.role_key = 'scriptwriter'`,
    [workspaceId, workOrderId],
  );

  return true;
}
