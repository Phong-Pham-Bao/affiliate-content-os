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

export async function assembleScriptPackageInitialAtomic(
  client: pg.PoolClient,
  params: {
    readonly workspaceId: string;
    readonly productId: string;
    readonly workOrderId: string;
    readonly workItemId: string;
    readonly assignmentId: string;
  },
): Promise<boolean> {
  const { workspaceId, productId, workOrderId, workItemId, assignmentId } = params;

  // 1. Check all 5 units succeeded
  const unitsRes = await client.query(
    `SELECT id, video_number, output_json, brief_hash
     FROM script_generation_units
     WHERE workspace_id = $1 AND work_order_id = $2 AND change_request_id IS NULL
       AND status = 'succeeded'
     ORDER BY video_number ASC`,
    [workspaceId, workOrderId],
  );

  if (unitsRes.rowCount !== 5) {
    return false;
  }

  // 2. Fetch brief
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

  // 3. Assemble 5 videos
  const videos: ScriptVideo[] = [];
  const sourceUnitIds: string[] = [];
  for (const row of unitsRes.rows) {
    videos.push(row.output_json.video as ScriptVideo);
    sourceUnitIds.push(row.id);
  }

  const allEvidence = videos.flatMap((v) => v.evidenceReferences ?? []);
  const pkg: ScriptPackage = validateScriptPackage({
    schemaVersion: 1,
    seriesTitle: brief.seriesPlan.seriesTitle,
    targetAudienceSummary: brief.audienceBoard.summary,
    creativeDirectionSummary: brief.seriesPlan.creativeDirection.visualTone,
    videos,
    evidenceReferences: allEvidence,
  });

  const pkgHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(pkg), 'utf8').digest(),
  );

  // 4. Ensure artifact row exists
  let artifactId: string;
  const existingArt = await client.query(
    `SELECT id, current_revision_number FROM content_artifacts
     WHERE workspace_id = $1 AND work_order_id = $2 AND artifact_type = 'script_package'`,
    [workspaceId, workOrderId],
  );

  if (existingArt.rowCount && existingArt.rowCount > 0 && existingArt.rows[0]) {
    artifactId = existingArt.rows[0].id;
  } else {
    artifactId = generateUuidV7();
    await client.query(
      `INSERT INTO content_artifacts (
         id, workspace_id, product_id, work_order_id, work_item_id,
         assignment_id, author_role_key, artifact_type, lifecycle_status,
         current_revision_number, created_at, updated_at, version
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, 'scriptwriter', 'script_package', 'review_required',
         1, NOW(), NOW(), 1
       )`,
      [artifactId, workspaceId, productId, workOrderId, workItemId, assignmentId],
    );
  }

  // 5. Insert revision 1 (idempotent)
  const revId = generateUuidV7();
  const insertRevRes = await client.query(
    `INSERT INTO content_artifact_revisions (
       id, workspace_id, artifact_id, revision_number, content_json,
       content_hash, schema_version, prompt_template, prompt_version,
       provider, model, token_input, token_output, cost_microunits,
       cost_currency, latency_ms, author_role_key, created_at
     ) VALUES (
       $1, $2, $3, 1, $4::jsonb,
       $5, 1, 'script_video_v1', 'v1',
       'google', 'gemini-3.8-flash', 0, 0, 0,
       'USD', 0, 'scriptwriter', NOW()
     ) ON CONFLICT (workspace_id, artifact_id, revision_number) DO NOTHING`,
    [revId, workspaceId, artifactId, JSON.stringify(pkg), Buffer.from(pkgHash)],
  );

  if (insertRevRes.rowCount === 0) {
    return true; // Already assembled
  }

  // 6. Insert evidence refs
  for (const ev of pkg.evidenceReferences) {
    await client.query(
      `INSERT INTO artifact_evidence_refs (
         id, workspace_id, artifact_id, revision_number, source_kind, source_id, created_at
       ) VALUES ($1, $2, $3, 1, $4, $5, NOW())
       ON CONFLICT (artifact_id, revision_number, source_kind, source_id) DO NOTHING`,
      [generateUuidV7(), workspaceId, artifactId, ev.sourceKind, ev.sourceId],
    );
  }

  // 7. Insert lineage
  await client.query(
    `INSERT INTO content_artifact_lineage (
       id, workspace_id, artifact_id, revision_number, parent_revision_number,
       lineage_type, change_request_id, content_brief_hash, content_brief_version,
       planning_revision_ids_json, source_script_unit_ids_json, metadata_json, created_at
     ) VALUES (
       $1, $2, $3, 1, NULL,
       'ai_generated', NULL, $4, 1,
       $5::jsonb, $6::jsonb, '{}'::jsonb, NOW()
     ) ON CONFLICT (artifact_id, revision_number) DO NOTHING`,
    [
      generateUuidV7(),
      workspaceId,
      artifactId,
      Buffer.from(briefHash),
      JSON.stringify(brief.planningRevisions),
      JSON.stringify(sourceUnitIds),
    ],
  );

  // 8. Update work item & assignment
  await client.query(
    `UPDATE work_items
     SET status = 'completed', completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [workItemId, workspaceId],
  );

  await client.query(
    `UPDATE agent_assignments
     SET office_state = 'completed', updated_at = NOW(), version = version + 1
     WHERE id = $1 AND workspace_id = $2`,
    [assignmentId, workspaceId],
  );

  // 9. Release compliance_review dependency to ready (honest waiting, not executed)
  await client.query(
    `UPDATE work_items
     SET status = 'ready', updated_at = NOW(), version = version + 1
     WHERE workspace_id = $1 AND work_order_id = $2
       AND task_key = 'compliance_review' AND status = 'waiting_dependency'`,
    [workspaceId, workOrderId],
  );

  await client.query(
    `UPDATE agent_assignments
     SET office_state = 'preparing', waiting_on_work_item_id = NULL, updated_at = NOW(), version = version + 1
     WHERE workspace_id = $1 AND work_order_id = $2
       AND work_item_id = (SELECT id FROM work_items WHERE workspace_id = $1 AND work_order_id = $2 AND task_key = 'compliance_review')`,
    [workspaceId, workOrderId],
  );

  return true;
}
