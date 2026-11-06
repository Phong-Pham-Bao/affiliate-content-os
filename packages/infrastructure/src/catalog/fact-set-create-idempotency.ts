import crypto from 'node:crypto';
import {
  IdempotencyKeyReusedError,
  type CreateFactSetPersistenceParams,
  type CreateFactSetPersistenceResult,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import type { TransactionExecutor } from '../database/types.js';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { mapProductFactRow, mapProductFactSetRow } from './mappers.js';

export async function checkFactSetIdempotency(
  tx: TransactionExecutor,
  params: CreateFactSetPersistenceParams,
): Promise<CreateFactSetPersistenceResult | null> {
  if (!params.idempotencyRecord) {
    return null;
  }

  const lockKey = computeIdempotencyAdvisoryLockKey(
    params.idempotencyRecord.principalId,
    params.idempotencyRecord.routeKey,
    params.idempotencyRecord.keyHash,
  );
  await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

  const existingResult = await tx.query<RawIdempotencyRow>(
    `SELECT id, workspace_id, principal_id, route_key, key_hash, request_hash,
            status_code, response_json, resource_type, resource_id, expires_at, created_at
     FROM idempotency_keys
     WHERE workspace_id = $1
       AND principal_id = $2
       AND route_key = $3
       AND key_hash = $4
     FOR UPDATE`,
    [
      params.factSet.workspaceId,
      params.idempotencyRecord.principalId,
      params.idempotencyRecord.routeKey,
      Buffer.from(params.idempotencyRecord.keyHash),
    ],
  );

  if (existingResult.rowCount === 0 || !existingResult.rows[0]) {
    return null;
  }

  const rawRow = existingResult.rows[0];
  const snapshot = validateAndMapIdempotencyRow(rawRow);
  const isExpired =
    Date.parse(snapshot.expiresAt) <= Date.parse(params.idempotencyRecord.createdAt);

  if (isExpired) {
    await tx.query('DELETE FROM idempotency_keys WHERE id = $1', [snapshot.id]);
    return null;
  }

  if (!crypto.timingSafeEqual(snapshot.requestHash, params.idempotencyRecord.requestHash)) {
    throw new IdempotencyKeyReusedError();
  }

  const factSetId = snapshot.resourceId;
  if (!factSetId) {
    throw new DatabaseError('Idempotency row missing fact set resourceId');
  }

  const fsResult = await tx.query<unknown>(
    `SELECT id, workspace_id, product_id, revision_number, status, summary,
            created_by_user_id, confirmed_by_user_id, confirmed_at, created_at, updated_at, version
     FROM product_fact_sets
     WHERE id = $1 AND product_id = $2 AND workspace_id = $3`,
    [factSetId, params.factSet.productId, params.factSet.workspaceId],
  );

  if (fsResult.rowCount === 0 || !fsResult.rows[0]) {
    throw new DatabaseError(`Persisted fact set not found for cached idempotency: ${factSetId}`);
  }

  const factsResult = await tx.query<unknown>(
    `SELECT id, workspace_id, product_id, fact_set_id, fact_key, value_text,
            source_type, source_url, source_excerpt, confidence, claim_usage, created_at
     FROM product_facts
     WHERE fact_set_id = $1 AND product_id = $2 AND workspace_id = $3
     ORDER BY created_at ASC, id ASC`,
    [factSetId, params.factSet.productId, params.factSet.workspaceId],
  );

  return {
    factSet: mapProductFactSetRow(fsResult.rows[0]),
    facts: factsResult.rows.map(mapProductFactRow),
    cached: true,
  };
}
