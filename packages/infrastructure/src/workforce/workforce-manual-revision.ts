import crypto from 'node:crypto';
import type pg from 'pg';
import {
  generateUuidV7,
  type CreateManualRevisionParams,
  type ContentArtifactDetailDTO,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import { getArtifactRevisionByNumberQuery } from './workforce-revision-queries.js';

export async function createManualRevisionTransaction(
  client: pg.PoolClient,
  params: CreateManualRevisionParams,
): Promise<ContentArtifactDetailDTO> {
  const {
    workspaceId,
    artifactId,
    actorUserId,
    expectedVersion,
    baseRevisionNumber,
    baseContentHashHex,
    content,
    note,
  } = params;

  // 1. Fetch artifact with optimistic lock
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
    throw new DatabaseError(`Artifact ${artifactId} not found in workspace`);
  }
  const art = artRes.rows[0];

  if (Number(art.version) !== expectedVersion) {
    throw new DatabaseError(
      `Precondition failed: artifact version mismatch (expected ${expectedVersion}, current ${art.version})`,
    );
  }
  if (Number(art.current_revision_number) !== baseRevisionNumber) {
    throw new DatabaseError(
      `Precondition failed: artifact revision mismatch (expected ${baseRevisionNumber}, current ${art.current_revision_number})`,
    );
  }

  // 2. Fetch base revision hash
  const baseRevRes = await client.query(
    `SELECT content_hash, schema_version
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, baseRevisionNumber],
  );
  if (baseRevRes.rowCount === 0 || !baseRevRes.rows[0]) {
    throw new DatabaseError(`Base revision ${baseRevisionNumber} not found`);
  }
  const actualHashHex = Buffer.from(baseRevRes.rows[0].content_hash).toString('hex');
  if (actualHashHex !== baseContentHashHex) {
    throw new DatabaseError('Precondition failed: base revision content hash mismatch');
  }

  // 3. Evidence validation: all affirmative claims must resolve to product's confirmed facts or accepted analyses
  if (content.evidenceReferences && content.evidenceReferences.length > 0) {
    const factIds = content.evidenceReferences
      .filter((e) => e.sourceKind === 'product_fact')
      .map((e) => e.sourceId);

    if (factIds.length > 0) {
      const validFactsRes = await client.query(
        `SELECT f.id
         FROM product_facts f
         JOIN product_fact_sets fs ON fs.id = f.fact_set_id AND fs.workspace_id = f.workspace_id
         WHERE fs.workspace_id = $1 AND fs.product_id = $2 AND fs.status = 'confirmed'
           AND f.confidence = 'confirmed' AND f.claim_usage = 'allowed'
           AND f.id = ANY($3::uuid[])`,
        [workspaceId, art.product_id, factIds],
      );
      if (validFactsRes.rowCount !== factIds.length) {
        throw new DatabaseError(
          'Evidence validation failed: one or more referenced product facts are not confirmed',
        );
      }
    }

    const analysisIds = content.evidenceReferences
      .filter((e) => e.sourceKind === 'analysis')
      .map((e) => e.sourceId);

    if (analysisIds.length > 0) {
      const validAnalysesRes = await client.query(
        `SELECT id FROM analyses
         WHERE workspace_id = $1 AND product_id = $2 AND status = 'accepted'
           AND id = ANY($3::uuid[])`,
        [workspaceId, art.product_id, analysisIds],
      );
      if (validAnalysesRes.rowCount !== analysisIds.length) {
        throw new DatabaseError(
          'Evidence validation failed: one or more referenced analyses are not accepted',
        );
      }
    }
  }

  // 4. Compute hash and new revision number
  const newHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest(),
  );
  const newRevNum = baseRevisionNumber + 1;
  const revId = generateUuidV7();

  // Fetch parent brief hash for lineage
  const parentLineageRes = await client.query(
    `SELECT content_brief_hash, content_brief_version, planning_revision_ids_json
     FROM content_artifact_lineage
     WHERE workspace_id = $1 AND artifact_id = $2
     ORDER BY revision_number DESC LIMIT 1`,
    [workspaceId, artifactId],
  );
  const briefHash = parentLineageRes.rows[0]?.content_brief_hash ?? new Uint8Array(32);
  const briefVer = parentLineageRes.rows[0]?.content_brief_version ?? 1;
  const planningRevIds = parentLineageRes.rows[0]?.planning_revision_ids_json ?? {};

  // 5. Insert new revision
  await client.query(
    `INSERT INTO content_artifact_revisions (
       id, workspace_id, artifact_id, revision_number, content_json,
       content_hash, schema_version, prompt_template, prompt_version,
       provider, model, token_input, token_output, cost_microunits,
       cost_currency, latency_ms, author_role_key, created_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb,
       $6, 1, 'manual_edit', 'v1',
       'manual', 'human_editor', 0, 0, 0,
       'USD', 0, 'scriptwriter', NOW()
     )`,
    [revId, workspaceId, artifactId, newRevNum, JSON.stringify(content), Buffer.from(newHash)],
  );

  // 6. Insert evidence refs
  for (const ev of content.evidenceReferences ?? []) {
    await client.query(
      `INSERT INTO artifact_evidence_refs (
         id, workspace_id, artifact_id, revision_number, source_kind, source_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (artifact_id, revision_number, source_kind, source_id) DO NOTHING`,
      [generateUuidV7(), workspaceId, artifactId, newRevNum, ev.sourceKind, ev.sourceId],
    );
  }

  // 7. Insert lineage
  await client.query(
    `INSERT INTO content_artifact_lineage (
       id, workspace_id, artifact_id, revision_number, parent_revision_number,
       lineage_type, change_request_id, content_brief_hash, content_brief_version,
       planning_revision_ids_json, source_script_unit_ids_json, metadata_json, created_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       'human_edited', NULL, $6, $7,
       $8::jsonb, '[]'::jsonb, $9::jsonb, NOW()
     )`,
    [
      generateUuidV7(),
      workspaceId,
      artifactId,
      newRevNum,
      baseRevisionNumber,
      briefHash,
      briefVer,
      JSON.stringify(planningRevIds),
      JSON.stringify({ note, editorUserId: actorUserId }),
    ],
  );

  // 8. Update artifact
  await client.query(
    `UPDATE content_artifacts
     SET current_revision_number = $1, version = version + 1, updated_at = NOW()
     WHERE workspace_id = $2 AND id = $3`,
    [newRevNum, workspaceId, artifactId],
  );

  // 9. Audit event
  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, changes_json, occurred_at, created_at
     ) VALUES ($1, $2, 'user', $3, 'artifact.revision_created', 'content_artifact', $4, 'succeeded', $5::jsonb, NOW(), NOW())`,
    [
      generateUuidV7(),
      workspaceId,
      actorUserId,
      artifactId,
      JSON.stringify({ revisionNumber: newRevNum, lineageType: 'human_edited' }),
    ],
  );

  const detail = await getArtifactRevisionByNumberQuery(client, workspaceId, artifactId, newRevNum);
  if (!detail) {
    throw new DatabaseError(`Failed to reload newly created revision ${newRevNum}`);
  }
  return detail;
}
