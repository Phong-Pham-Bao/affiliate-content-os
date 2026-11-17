import crypto from 'node:crypto';
import type pg from 'pg';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type RejectScriptRevisionParams,
  type RejectScriptRevisionResult,
  type ContentReviewDecisionDTO,
  ArtifactNotFoundError,
  ArtifactRevisionConflictError,
  ContentReviewDecisionConflictError,
} from '@affiliate-content-os/application';
import { CURRENT_COMPLIANCE_POLICY_VERSION, parseIsoTimestamp } from '@affiliate-content-os/domain';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { getArtifactRevisionByNumberQuery } from './workforce-revision-queries.js';

export async function rejectScriptRevisionTransaction(
  client: pg.PoolClient,
  params: RejectScriptRevisionParams,
): Promise<RejectScriptRevisionResult> {
  const {
    workspaceId,
    artifactId,
    actorUserId,
    expectedVersion,
    revisionNumber,
    contentHashHex,
    reason,
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

      return snapshot.responseJson as unknown as RejectScriptRevisionResult;
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
    throw new ArtifactRevisionConflictError(`Cannot reject artifact type ${art.artifact_type}`);
  }
  if (art.lifecycle_status === 'accepted' || art.lifecycle_status === 'rejected') {
    throw new ArtifactRevisionConflictError(
      `Precondition failed: artifact is already in terminal "${art.lifecycle_status}" lifecycle status`,
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
    `SELECT content_hash
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

  // 6. Look up current evaluation if available
  const evalRes = await client.query(
    `SELECT id
     FROM compliance_evaluations
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3 AND policy_version = $4`,
    [workspaceId, artifactId, revisionNumber, CURRENT_COMPLIANCE_POLICY_VERSION],
  );
  const evaluationId = evalRes.rows[0]?.id ?? null;

  // 7. Insert human decision record into content_review_decisions
  const decisionId = generateUuidV7();
  await client.query(
    `INSERT INTO content_review_decisions (
       id, workspace_id, artifact_id, revision_number, content_hash,
       evaluation_id, decision, actor_user_id, reason, metadata_json, created_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, 'reject', $7, $8, '{}'::jsonb, NOW()
     )`,
    [
      decisionId,
      workspaceId,
      artifactId,
      revisionNumber,
      Buffer.from(actualHashHex, 'hex'),
      evaluationId,
      actorUserId,
      reason,
    ],
  );

  // 8. Update artifact lifecycle to 'rejected' with optimistic precondition checks
  const updateArtRes = await client.query(
    `UPDATE content_artifacts
     SET lifecycle_status = 'rejected', version = version + 1, updated_at = NOW()
     WHERE workspace_id = $1 AND id = $2 AND version = $3 AND current_revision_number = $4 AND lifecycle_status = 'review_required'`,
    [workspaceId, artifactId, art.version, revisionNumber],
  );
  if (updateArtRes.rowCount !== 1) {
    throw new ArtifactRevisionConflictError(
      'Precondition failed: artifact state conflict during rejection',
    );
  }

  // 9. Write audit event
  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, changes_json, occurred_at, created_at
     ) VALUES (
       $1, $2, 'user', $3, 'artifact.rejected', 'content_artifact',
       $4, 'succeeded', $5::jsonb, NOW(), NOW()
     )`,
    [
      generateUuidV7(),
      workspaceId,
      actorUserId,
      artifactId,
      JSON.stringify({ revisionNumber, contentHashHex: actualHashHex, decisionId, reason }),
    ],
  );

  // 10. Build return DTOs
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
    evaluationId,
    decision: 'reject',
    actorUserId,
    reason,
    metadata: {},
    createdAt: parseIsoTimestamp(new Date().toISOString()),
  };

  const responseResult: RejectScriptRevisionResult = {
    artifact: updatedDetail!,
    decision: decisionDTO,
  };

  // 11. Persist idempotency cache
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
