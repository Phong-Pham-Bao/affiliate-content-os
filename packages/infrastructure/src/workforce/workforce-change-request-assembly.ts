import crypto from 'node:crypto';
import type pg from 'pg';
import { generateUuidV7 } from '@affiliate-content-os/application';
import {
  validateScriptPackage,
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

  // 1. Fetch change request
  const crRes = await client.query(
    `SELECT artifact_id, base_revision_number, selected_video_numbers, instruction_text
     FROM artifact_change_requests
     WHERE workspace_id = $1 AND id = $2 AND status = 'in_progress'
     FOR UPDATE`,
    [workspaceId, changeRequestId],
  );

  if (crRes.rowCount === 0 || !crRes.rows[0]) {
    return false;
  }
  const cr = crRes.rows[0];
  const artifactId = cr.artifact_id;
  const baseRevNum = cr.base_revision_number;
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

  // 3. Fetch base revision content
  const baseRevRes = await client.query(
    `SELECT content_json FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, baseRevNum],
  );

  if (baseRevRes.rowCount === 0 || !baseRevRes.rows[0]) {
    throw new DatabaseError(
      `Base revision ${baseRevNum} not found for change request ${changeRequestId}`,
    );
  }
  const baseContent = baseRevRes.rows[0].content_json as ScriptPackage;

  // Map replacement videos by videoNumber
  const replacementMap = new Map<
    number,
    { video: ScriptVideo; unitId: string; briefHash: Uint8Array }
  >();
  const sourceUnitIds: string[] = [];
  let briefHash = new Uint8Array(32);

  for (const row of unitsRes.rows) {
    const vNum = Number(row.video_number);
    const bHash = new Uint8Array(row.brief_hash);
    briefHash = bHash;
    replacementMap.set(vNum, {
      video: row.output_json.video as ScriptVideo,
      unitId: row.id,
      briefHash: bHash,
    });
    sourceUnitIds.push(row.id);
  }

  // 4. Merge videos
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
  const newPkg: ScriptPackage = validateScriptPackage({
    schemaVersion: 1,
    seriesTitle: baseContent.seriesTitle,
    targetAudienceSummary: baseContent.targetAudienceSummary,
    creativeDirectionSummary: baseContent.creativeDirectionSummary,
    videos: mergedVideos,
    evidenceReferences: allEvidence,
  });

  const newHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(newPkg), 'utf8').digest(),
  );

  // 5. Get current revision number
  const artRes = await client.query(
    `SELECT current_revision_number, version, work_order_id
     FROM content_artifacts
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [workspaceId, artifactId],
  );
  if (artRes.rowCount === 0 || !artRes.rows[0]) {
    throw new DatabaseError(`Artifact ${artifactId} not found`);
  }
  const newRevNum = artRes.rows[0].current_revision_number + 1;
  const workOrderId = artRes.rows[0].work_order_id;
  const revId = generateUuidV7();

  // 6. Insert new revision
  await client.query(
    `INSERT INTO content_artifact_revisions (
       id, workspace_id, artifact_id, revision_number, content_json,
       content_hash, schema_version, prompt_template, prompt_version,
       provider, model, token_input, token_output, cost_microunits,
       cost_currency, latency_ms, author_role_key, created_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb,
       $6, 1, 'script_video_v1', 'v1',
       'google', 'gemini-3.8-flash', 0, 0, 0,
       'USD', 0, 'scriptwriter', NOW()
     )`,
    [revId, workspaceId, artifactId, newRevNum, JSON.stringify(newPkg), Buffer.from(newHash)],
  );

  // 7. Insert evidence refs
  for (const ev of newPkg.evidenceReferences) {
    await client.query(
      `INSERT INTO artifact_evidence_refs (
         id, workspace_id, artifact_id, revision_number, source_kind, source_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (artifact_id, revision_number, source_kind, source_id) DO NOTHING`,
      [generateUuidV7(), workspaceId, artifactId, newRevNum, ev.sourceKind, ev.sourceId],
    );
  }

  // 8. Insert lineage
  await client.query(
    `INSERT INTO content_artifact_lineage (
       id, workspace_id, artifact_id, revision_number, parent_revision_number,
       lineage_type, change_request_id, content_brief_hash, content_brief_version,
       planning_revision_ids_json, source_script_unit_ids_json, metadata_json, created_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       'change_request', $6, $7, 1,
       '{}'::jsonb, $8::jsonb, $9::jsonb, NOW()
     )`,
    [
      generateUuidV7(),
      workspaceId,
      artifactId,
      newRevNum,
      baseRevNum,
      changeRequestId,
      Buffer.from(briefHash),
      JSON.stringify(sourceUnitIds),
      JSON.stringify({ instruction: cr.instruction_text, replacedVideos: selectedVideoNumbers }),
    ],
  );

  // 9. Update artifact & change request
  await client.query(
    `UPDATE content_artifacts
     SET current_revision_number = $1, version = version + 1, updated_at = NOW()
     WHERE workspace_id = $2 AND id = $3`,
    [newRevNum, workspaceId, artifactId],
  );

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
