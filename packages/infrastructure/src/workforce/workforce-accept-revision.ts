import crypto from 'node:crypto';
import type pg from 'pg';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type AcceptScriptRevisionParams,
  type AcceptScriptRevisionResult,
  type ContentApprovalSnapshotDTO,
  type ContentReviewDecisionDTO,
} from '@affiliate-content-os/application';
import { CURRENT_COMPLIANCE_POLICY_VERSION, parseIsoTimestamp } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
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
  if (Number(art.current_revision_number) !== revisionNumber) {
    throw new DatabaseError(
      `Precondition failed: artifact revision mismatch (expected ${revisionNumber}, current ${art.current_revision_number})`,
    );
  }

  // 4. Fetch revision and verify content hash
  const revRes = await client.query(
    `SELECT content_json, content_hash, schema_version
     FROM content_artifact_revisions
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  if (revRes.rowCount === 0 || !revRes.rows[0]) {
    throw new DatabaseError(`Revision ${revisionNumber} not found`);
  }
  const actualHashHex = Buffer.from(revRes.rows[0].content_hash).toString('hex');
  if (actualHashHex.toLowerCase() !== contentHashHex.toLowerCase()) {
    throw new DatabaseError('Precondition failed: content hash mismatch');
  }

  // 5. Fetch completed compliance evaluation for this revision and policy
  const evalRes = await client.query(
    `SELECT id, status, result, blocking_count, warning_count, policy_version, policy_hash
     FROM compliance_evaluations
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3 AND policy_version = $4
     FOR UPDATE`,
    [workspaceId, artifactId, revisionNumber, CURRENT_COMPLIANCE_POLICY_VERSION],
  );

  if (evalRes.rowCount === 0 || !evalRes.rows[0]) {
    throw new DatabaseError(
      `Precondition failed: no compliance evaluation found for revision ${revisionNumber} under policy ${CURRENT_COMPLIANCE_POLICY_VERSION}`,
    );
  }
  const evalRow = evalRes.rows[0];

  if (evalRow.status !== 'completed') {
    throw new DatabaseError(
      `Precondition failed: compliance evaluation is still ${evalRow.status}`,
    );
  }
  if (evalRow.result === 'blocked' || Number(evalRow.blocking_count) > 0) {
    throw new DatabaseError(
      `Precondition failed: content has ${evalRow.blocking_count} blocking compliance finding(s)`,
    );
  }
  if (evalRow.result === 'failed') {
    throw new DatabaseError('Precondition failed: compliance evaluation resulted in failure');
  }

  // 6. Fetch evidence references for snapshot
  const evidenceRes = await client.query(
    `SELECT source_kind, source_id
     FROM artifact_evidence_refs
     WHERE workspace_id = $1 AND artifact_id = $2 AND revision_number = $3`,
    [workspaceId, artifactId, revisionNumber],
  );
  const evidenceIds = evidenceRes.rows.map((r) => r.source_id);

  // Extract disclosure state
  const scriptPkg = revRes.rows[0].content_json;
  const videos = Array.isArray(scriptPkg?.videos) ? scriptPkg.videos : [];
  const disclosureState = {
    disclosures: videos.map((v: { videoNumber?: number; disclosure?: unknown }) => ({
      videoNumber: v.videoNumber,
      disclosure: v.disclosure,
    })),
  };

  // 7. Insert human decision record into content_review_decisions
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

  // 8. Create immutable approval snapshot in content_approval_snapshots
  const snapshotId = generateUuidV7();
  const snapshotJson = {
    artifactId,
    revisionNumber,
    contentHashHex: actualHashHex,
    content: scriptPkg,
    evaluationId: evalRow.id,
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

  // 9. Update artifact lifecycle to 'accepted'
  await client.query(
    `UPDATE content_artifacts
     SET lifecycle_status = 'accepted', version = version + 1, updated_at = NOW()
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, artifactId],
  );

  // 10. Complete work order handoff state
  await client.query(
    `UPDATE work_orders
     SET status = 'completed', completed_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, art.work_order_id],
  );

  await client.query(
    `UPDATE agent_assignments a
     SET office_state = 'completed', updated_at = NOW(), version = a.version + 1
     FROM agent_role_definitions r
     WHERE a.role_definition_id = r.id
       AND a.workspace_id = $1
       AND a.work_order_id = $2
       AND r.role_key = 'chief_of_staff'`,
    [workspaceId, art.work_order_id],
  );

  // 11. Write audit event
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

  // 12. Build return DTOs
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

  const approvalSnapshotDTO: ContentApprovalSnapshotDTO = {
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
    approvalSnapshot: approvalSnapshotDTO,
  };

  // 13. Persist idempotency cache
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
