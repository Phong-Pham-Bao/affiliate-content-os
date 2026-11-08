import crypto from 'node:crypto';
import type pg from 'pg';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  type ArtifactChangeRequestDTO,
  type RequestScriptChangesParams,
} from '@affiliate-content-os/application';
import { parseIsoTimestamp } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { SCRIPT_UNIT_COST_MICROUNITS } from './workforce-scriptwriting-kickoff.js';

export async function requestScriptChangesTransaction(
  client: pg.PoolClient,
  params: RequestScriptChangesParams,
): Promise<ArtifactChangeRequestDTO> {
  const {
    workspaceId,
    artifactId,
    actorUserId,
    expectedVersion,
    baseRevisionNumber,
    baseContentHashHex,
    instructionText,
    selectedVideoNumbers,
    targetVariantCount = 1,
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

      const crId = snapshot.resourceId;
      if (!crId) {
        throw new DatabaseError(
          'Corrupt database row: missing change_request resourceId in idempotency record',
        );
      }

      const existingCr = await client.query(
        `SELECT id, artifact_id, base_revision_number, base_content_hash, requested_by_user_id,
                instruction_text, selected_video_numbers, target_variant_count, status,
                resulting_revision_number, failure_reason, failure_code, created_at, updated_at, version
         FROM artifact_change_requests
         WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, crId],
      );

      if (existingCr.rowCount === 0 || !existingCr.rows[0]) {
        throw new DatabaseError(
          `Persisted change request not found for idempotency record: ${crId}`,
        );
      }

      const row = existingCr.rows[0];
      return {
        id: row.id,
        artifactId: row.artifact_id,
        baseRevisionNumber: row.base_revision_number,
        baseContentHashHex: Buffer.from(row.base_content_hash).toString('hex'),
        requestedByUserId: row.requested_by_user_id,
        instructionText: row.instruction_text,
        selectedVideoNumbers: row.selected_video_numbers,
        targetVariantCount: row.target_variant_count,
        status: row.status,
        resultingRevisionNumber: row.resulting_revision_number,
        failureReason: row.failure_reason,
        failureCode: row.failure_code ? String(row.failure_code) : null,
        createdAt: parseIsoTimestamp(
          row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        ),
        updatedAt: parseIsoTimestamp(
          row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
        ),
        version: Number(row.version),
      };
    }
  }

  // 3. Fetch artifact with optimistic lock
  const artRes = await client.query(
    `SELECT id, product_id, work_order_id, work_item_id, assignment_id,
            author_role_key, artifact_type, current_revision_number, version
     FROM content_artifacts
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [workspaceId, artifactId],
  );

  if (artRes.rowCount === 0 || !artRes.rows[0]) {
    throw new DatabaseError(`Artifact ${artifactId} not found`);
  }
  const art = artRes.rows[0];

  if (art.artifact_type !== 'script_package') {
    throw new DatabaseError(`Cannot request changes on artifact type ${art.artifact_type}`);
  }
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
    `SELECT content_hash
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

  // 5. Fail closed on authoritative context: content brief MUST exist (never substitute all-zero hash)
  const briefRes = await client.query(
    `SELECT brief_hash FROM content_briefs
     WHERE workspace_id = $1 AND work_order_id = $2
     ORDER BY brief_version DESC LIMIT 1`,
    [workspaceId, art.work_order_id],
  );
  if (briefRes.rowCount === 0 || !briefRes.rows[0]) {
    throw new DatabaseError(
      `Cannot request changes: content brief not found for work order ${art.work_order_id}`,
    );
  }
  const briefHash = new Uint8Array(briefRes.rows[0].brief_hash);

  // 6. Check and reserve budget
  const totalReservation = selectedVideoNumbers.length * SCRIPT_UNIT_COST_MICROUNITS;
  const policyRes = await client.query(
    `SELECT monthly_budget_microunits, current_spend_microunits, reserved_spend_microunits
     FROM workspace_ai_policies
     WHERE workspace_id = $1
     FOR UPDATE`,
    [workspaceId],
  );

  if (policyRes.rowCount === 0 || !policyRes.rows[0]) {
    throw new DatabaseError('Workspace AI policy not configured');
  }
  const policy = policyRes.rows[0];
  const budget = Number(policy.monthly_budget_microunits);
  const spend = Number(policy.current_spend_microunits);
  const reserved = Number(policy.reserved_spend_microunits);

  if (spend + reserved + totalReservation > budget) {
    throw new DatabaseError('Insufficient workspace AI budget for requested video regeneration');
  }

  const updatePolicyRes = await client.query(
    `UPDATE workspace_ai_policies
     SET reserved_spend_microunits = reserved_spend_microunits + $1,
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $2`,
    [totalReservation, workspaceId],
  );
  if (updatePolicyRes.rowCount !== 1) {
    throw new DatabaseError('Failed to reserve workspace AI policy budget');
  }

  // 7. Create artifact_change_requests row
  const changeRequestId = generateUuidV7();
  await client.query(
    `INSERT INTO artifact_change_requests (
       id, workspace_id, artifact_id, base_revision_number, base_content_hash,
       requested_by_user_id, instruction_text, selected_video_numbers,
       target_variant_count, status, resulting_revision_number,
       failure_reason, created_at, updated_at, version
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8::jsonb,
       $9, 'in_progress', NULL,
       NULL, NOW(), NOW(), 1
     )`,
    [
      changeRequestId,
      workspaceId,
      artifactId,
      baseRevisionNumber,
      Buffer.from(baseRevRes.rows[0].content_hash),
      actorUserId,
      instructionText,
      JSON.stringify(selectedVideoNumbers),
      targetVariantCount,
    ],
  );

  // 8. Enqueue jobs & script units for selected videos
  for (const videoNumber of selectedVideoNumbers) {
    const opId = generateUuidV7();
    const aiRunId = generateUuidV7();
    const jobId = generateUuidV7();
    const unitId = generateUuidV7();
    const dedupKey = `${changeRequestId}:video:${videoNumber}`;

    await client.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, progress_percent, result_location, error_category, error_code, error_message,
         requested_by_user_id, started_at, completed_at, created_at, updated_at, version,
         work_order_id, work_item_id
       ) VALUES (
         $1, $2, 'scriptwriting', 'product', $3,
         'queued', NULL, NULL, NULL, NULL, NULL,
         $4, NULL, NULL, NOW(), NOW(), 1,
         $5, $6
       )`,
      [opId, workspaceId, art.product_id, actorUserId, art.work_order_id, art.work_item_id],
    );

    await client.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, output_hash, status, attempt, is_repair, token_input, token_output,
         cost_microunits, cost_currency, latency_ms, safety_result, error_category,
         requested_by_user_id, started_at, completed_at, created_at, updated_at, version,
         work_order_id, work_item_id
       ) VALUES (
         $1, $2, $3, 'scriptwriting', 'google', 'gemini-3.8-flash',
         'scriptwriting', '1.0.0', 1, 1,
         $4, NULL, 'queued', 1, FALSE, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL,
         $5, NULL, NULL, NOW(), NOW(), 1,
         $6, $7
       )`,
      [
        aiRunId,
        workspaceId,
        opId,
        Buffer.from(briefHash),
        actorUserId,
        art.work_order_id,
        art.work_item_id,
      ],
    );

    const payload = {
      workspaceId,
      productId: art.product_id,
      workOrderId: art.work_order_id,
      workItemId: art.work_item_id,
      assignmentId: art.assignment_id,
      videoNumber,
      targetVariantCount,
      changeRequestId,
      changeInstruction: instructionText,
      reservedMicrounits: SCRIPT_UNIT_COST_MICROUNITS,
      briefHash: Buffer.from(briefHash).toString('hex'),
      operationId: opId,
      aiRunId,
    };

    await client.query(
      `INSERT INTO job_executions (
         id, workspace_id, operation_id, ai_run_id, job_type, deduplication_key,
         status, attempt, max_attempts, repair_attempt, max_repair_attempts,
         lease_owner, lease_expires_at, next_attempt_at, started_at, completed_at,
         last_error_category, payload_json, correlation_id, reserved_spend_microunits,
         work_order_id, work_item_id, created_at, updated_at, version
       ) VALUES (
         $1, $2, $3, $4, 'scriptwriting', $5,
         'queued', 0, 3, 0, 1,
         NULL, NULL, NOW(), NULL, NULL,
         NULL, $6::jsonb, NULL, $7,
         $8, $9, NOW(), NOW(), 1
       )`,
      [
        jobId,
        workspaceId,
        opId,
        aiRunId,
        dedupKey,
        JSON.stringify(payload),
        SCRIPT_UNIT_COST_MICROUNITS,
        art.work_order_id,
        art.work_item_id,
      ],
    );

    await client.query(
      `INSERT INTO script_generation_units (
         id, workspace_id, work_order_id, work_item_id, video_number,
         target_variant_count, change_request_id, status, operation_id,
         ai_run_id, job_id, brief_hash, output_json, content_hash,
         error_category, error_message, created_at, updated_at, version
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, 'queued', $8,
         $9, $10, $11, NULL, NULL,
         NULL, NULL, NOW(), NOW(), 1
       )`,
      [
        unitId,
        workspaceId,
        art.work_order_id,
        art.work_item_id,
        videoNumber,
        targetVariantCount,
        changeRequestId,
        opId,
        aiRunId,
        jobId,
        Buffer.from(briefHash),
      ],
    );
  }

  // 9. Update scriptwriter assignment state to running
  await client.query(
    `UPDATE agent_assignments
     SET office_state = 'running', updated_at = NOW(), version = version + 1
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, art.assignment_id],
  );

  const resultDto: ArtifactChangeRequestDTO = {
    id: changeRequestId,
    artifactId,
    baseRevisionNumber,
    baseContentHashHex,
    requestedByUserId: actorUserId,
    instructionText,
    selectedVideoNumbers,
    targetVariantCount,
    status: 'in_progress',
    resultingRevisionNumber: null,
    failureReason: null,
    failureCode: null,
    createdAt: parseIsoTimestamp(new Date().toISOString()),
    updatedAt: parseIsoTimestamp(new Date().toISOString()),
    version: 1,
  };

  // 10. Persist idempotency record
  await client.query(
    `INSERT INTO idempotency_keys (
       id, workspace_id, principal_id, route_key, key_hash, request_hash,
       status_code, response_json, resource_type, resource_id, expires_at, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       202, $7::jsonb, 'artifact_change_request', $8, NOW() + INTERVAL '24 hours', NOW()
     )
     ON CONFLICT (workspace_id, principal_id, route_key, key_hash) WHERE workspace_id IS NOT NULL DO NOTHING`,
    [
      generateUuidV7(),
      workspaceId,
      actorUserId,
      idempotency.routeKey,
      Buffer.from(idempotency.keyHash),
      Buffer.from(idempotency.requestHash),
      JSON.stringify(resultDto),
      changeRequestId,
    ],
  );

  return resultDto;
}
