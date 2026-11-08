import crypto from 'node:crypto';
import type pg from 'pg';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type CreateManualRevisionParams,
  type ContentArtifactDetailDTO,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
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

      return snapshot.responseJson as unknown as ContentArtifactDetailDTO;
    }
  }

  // 3. Fetch artifact with optimistic lock
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

  // 4. Fetch base revision hash
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

  // 5. Evidence validation: validate union of package-level and video-level evidence
  const allEvMap = new Map<string, { sourceKind: string; sourceId: string }>();
  for (const ev of content.evidenceReferences ?? []) {
    allEvMap.set(`${ev.sourceKind}:${ev.sourceId}`, {
      sourceKind: ev.sourceKind,
      sourceId: ev.sourceId,
    });
  }

  // Enforce canonical relationship: every video evidence reference MUST be present in package-level evidence
  for (const video of content.videos ?? []) {
    for (const ev of video.evidenceReferences ?? []) {
      const key = `${ev.sourceKind}:${ev.sourceId}`;
      if (!allEvMap.has(key)) {
        throw new DatabaseError(
          `Evidence validation failed: video ${video.videoNumber} references evidence ${key} not declared in package evidenceReferences`,
        );
      }
    }
  }

  // Fetch authoritative context package for this work order
  const woRes = await client.query(
    `SELECT context_package_id FROM work_orders
     WHERE workspace_id = $1 AND id = $2 AND product_id = $3`,
    [workspaceId, art.work_order_id, art.product_id],
  );
  if (woRes.rowCount === 0 || !woRes.rows[0]) {
    throw new DatabaseError(
      `Authoritative context failed: work order ${art.work_order_id} not found`,
    );
  }
  const contextPackageId = woRes.rows[0].context_package_id;

  const allEvidenceList = Array.from(allEvMap.values());
  if (allEvidenceList.length > 0) {
    const factIds = allEvidenceList
      .filter((e) => e.sourceKind === 'product_fact')
      .map((e) => e.sourceId);

    if (factIds.length > 0) {
      const validFactsRes = await client.query(
        `SELECT f.id
         FROM product_facts f
         JOIN context_packages cp ON cp.fact_set_id = f.fact_set_id AND cp.workspace_id = f.workspace_id
         WHERE cp.workspace_id = $1 AND cp.id = $2
           AND f.confidence = 'confirmed' AND f.claim_usage = 'allowed'
           AND f.id = ANY($3::uuid[])`,
        [workspaceId, contextPackageId, factIds],
      );
      if (validFactsRes.rowCount !== factIds.length) {
        throw new DatabaseError(
          'Evidence validation failed: one or more referenced product facts are not confirmed, not allowed, or outside authoritative context',
        );
      }
    }

    const analysisIds = allEvidenceList
      .filter((e) => e.sourceKind === 'analysis')
      .map((e) => e.sourceId);

    if (analysisIds.length > 0) {
      const validAnalysesRes = await client.query(
        `SELECT cpa.analysis_id AS id
         FROM context_package_analyses cpa
         JOIN analyses a ON a.id = cpa.analysis_id AND a.workspace_id = cpa.workspace_id
         WHERE cpa.workspace_id = $1 AND cpa.context_package_id = $2
           AND a.product_id = $3
           AND a.status = 'accepted'
           AND a.id = ANY($4::uuid[])`,
        [workspaceId, contextPackageId, art.product_id, analysisIds],
      );
      if (validAnalysesRes.rowCount !== analysisIds.length) {
        throw new DatabaseError(
          'Evidence validation failed: one or more referenced analyses are not accepted, belong to another product, or are outside authoritative context',
        );
      }
    }
  }

  // 6. Compute hash and new revision number
  const newHash = new Uint8Array(
    crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest(),
  );
  const newRevNum = baseRevisionNumber + 1;
  const revId = generateUuidV7();

  // Fetch parent lineage
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

  // 7. Insert new revision
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

  // 8. Insert evidence refs
  for (const ev of allEvidenceList) {
    await client.query(
      `INSERT INTO artifact_evidence_refs (
         id, workspace_id, artifact_id, revision_number, source_kind, source_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (artifact_id, revision_number, source_kind, source_id) DO NOTHING`,
      [generateUuidV7(), workspaceId, artifactId, newRevNum, ev.sourceKind, ev.sourceId],
    );
  }

  // 9. Insert lineage
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

  // 10. Update artifact
  await client.query(
    `UPDATE content_artifacts
     SET current_revision_number = $1, version = version + 1, updated_at = NOW()
     WHERE workspace_id = $2 AND id = $3`,
    [newRevNum, workspaceId, artifactId],
  );

  // 11. Audit event
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

  // 12. Persist idempotency record
  await client.query(
    `INSERT INTO idempotency_keys (
       id, workspace_id, principal_id, route_key, key_hash, request_hash,
       status_code, response_json, resource_type, resource_id, expires_at, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       201, $7::jsonb, 'content_artifact_revision', $8, NOW() + INTERVAL '24 hours', NOW()
     )
     ON CONFLICT (workspace_id, principal_id, route_key, key_hash) WHERE workspace_id IS NOT NULL DO NOTHING`,
    [
      generateUuidV7(),
      workspaceId,
      actorUserId,
      idempotency.routeKey,
      Buffer.from(idempotency.keyHash),
      Buffer.from(idempotency.requestHash),
      JSON.stringify(detail),
      revId,
    ],
  );

  return detail;
}
