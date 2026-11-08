import crypto from 'node:crypto';
import type pg from 'pg';
import {
  IdempotencyKeyReusedError,
  type KickoffTransactionResult,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../database/errors.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import { mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';
import type { KickoffPersistenceSnapshot } from './workforce-types.js';

export async function checkKickoffIdempotency(
  client: pg.PoolClient,
  snapshot: KickoffPersistenceSnapshot,
): Promise<KickoffTransactionResult | null> {
  // 1. Transaction-scoped advisory lock for concurrency serialization on idempotency key
  const lockKey = computeIdempotencyAdvisoryLockKey(
    snapshot.idempotency.principalId,
    snapshot.idempotency.routeKey,
    snapshot.idempotency.keyHash,
  );
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

  // 2. Check idempotency record
  const idempCheck = await client.query<RawIdempotencyRow>(
    `SELECT id, workspace_id, principal_id, route_key, key_hash, request_hash,
            status_code, response_json, resource_type, resource_id, expires_at, created_at
     FROM idempotency_keys
     WHERE workspace_id = $1 AND principal_id = $2 AND route_key = $3 AND key_hash = $4
     FOR UPDATE`,
    [
      snapshot.workOrder.workspaceId,
      snapshot.idempotency.principalId,
      snapshot.idempotency.routeKey,
      snapshot.idempotency.keyHashBuf,
    ],
  );

  if (idempCheck.rowCount !== 0 && idempCheck.rows[0]) {
    const rawRow = idempCheck.rows[0];
    const idempSnapshot = validateAndMapIdempotencyRow(rawRow);

    const txTimeRes = await client.query<{ now: Date | string }>(
      'SELECT transaction_timestamp() AS now',
    );
    if (!txTimeRes.rows[0] || !txTimeRes.rows[0].now) {
      throw new DatabaseError('Failed to query PostgreSQL transaction timestamp');
    }
    const rawTxTime = txTimeRes.rows[0].now;
    const txTimeMs =
      rawTxTime instanceof Date ? rawTxTime.getTime() : Date.parse(String(rawTxTime));
    if (Number.isNaN(txTimeMs)) {
      throw new DatabaseError('Invalid PostgreSQL transaction timestamp');
    }

    const expiresAtMs = Date.parse(idempSnapshot.expiresAt);
    const isExpired = expiresAtMs <= txTimeMs;

    if (isExpired) {
      await client.query('DELETE FROM idempotency_keys WHERE id = $1', [idempSnapshot.id]);
      return null;
    }

    if (
      idempSnapshot.requestHash.byteLength !== snapshot.idempotency.requestHash.byteLength ||
      !crypto.timingSafeEqual(idempSnapshot.requestHash, snapshot.idempotency.requestHash)
    ) {
      throw new IdempotencyKeyReusedError();
    }

    const workOrderId = idempSnapshot.resourceId;
    if (!workOrderId) {
      throw new DatabaseError(
        'Corrupt database row: missing work_order resourceId in idempotency record',
      );
    }

    const existingOrder = await client.query(
      `SELECT * FROM work_orders WHERE workspace_id = $1 AND id = $2`,
      [snapshot.workOrder.workspaceId, workOrderId],
    );

    if (existingOrder.rowCount === 0 || !existingOrder.rows[0]) {
      throw new DatabaseError(
        'Corrupt database row: persisted work order not found for idempotency record',
      );
    }

    return {
      workOrder: mapWorkOrderRowToSummaryDTO(existingOrder.rows[0]),
      cached: true,
    };
  }

  return null;
}
