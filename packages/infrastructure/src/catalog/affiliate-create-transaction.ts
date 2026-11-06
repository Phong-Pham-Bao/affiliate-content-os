import crypto from 'node:crypto';
import {
  AffiliateDestinationNotFoundError,
  IdempotencyConflictError,
  IdempotencyKeyReusedError,
  ProductNotFoundError,
  type CreateAffiliateDestinationPersistenceParams,
  type CreateAffiliateDestinationPersistenceResult,
} from '@affiliate-content-os/application';
import { DatabaseError, sanitizeDatabaseError } from '../database/errors.js';
import type { TransactionExecutor } from '../database/types.js';
import { createTransactionScopedPostgresAuditAdapter } from '../audit/index.js';
import {
  computeIdempotencyAdvisoryLockKey,
  insertIdempotencyRecord,
} from '../tenancy/postgres-idempotency-adapter.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { mapAffiliateDestinationRow } from './mappers.js';

export async function executeCreateAffiliateTransaction(
  tx: TransactionExecutor,
  params: CreateAffiliateDestinationPersistenceParams,
): Promise<CreateAffiliateDestinationPersistenceResult> {
  try {
    if (params.idempotencyRecord) {
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
          params.destination.workspaceId,
          params.idempotencyRecord.principalId,
          params.idempotencyRecord.routeKey,
          Buffer.from(params.idempotencyRecord.keyHash),
        ],
      );

      if (existingResult.rowCount !== 0 && existingResult.rows[0]) {
        const rawRow = existingResult.rows[0];
        const snapshot = validateAndMapIdempotencyRow(rawRow);
        const isExpired =
          Date.parse(snapshot.expiresAt) <= Date.parse(params.idempotencyRecord.createdAt);

        if (isExpired) {
          await tx.query('DELETE FROM idempotency_keys WHERE id = $1', [snapshot.id]);
        } else {
          if (!crypto.timingSafeEqual(snapshot.requestHash, params.idempotencyRecord.requestHash)) {
            throw new IdempotencyKeyReusedError();
          }

          const destinationId = snapshot.resourceId;
          if (!destinationId) {
            throw new DatabaseError('Idempotency row missing destination resourceId');
          }

          const destResult = await tx.query<unknown>(
            `SELECT id, workspace_id, product_id, label, url, network_name, status,
                    created_at, updated_at, version
             FROM affiliate_destinations
             WHERE id = $1 AND product_id = $2 AND workspace_id = $3`,
            [destinationId, params.destination.productId, params.destination.workspaceId],
          );

          if (destResult.rowCount === 0 || !destResult.rows[0]) {
            throw new DatabaseError(
              `Persisted destination not found for cached idempotency: ${destinationId}`,
            );
          }

          return {
            destination: mapAffiliateDestinationRow(destResult.rows[0]),
            cached: true,
          };
        }
      }
    }

    const prodCheckResult = await tx.query<{ readonly id: string }>(
      `SELECT id FROM products WHERE id = $1 AND workspace_id = $2`,
      [params.destination.productId, params.destination.workspaceId],
    );

    if (prodCheckResult.rowCount === 0 || !prodCheckResult.rows[0]) {
      throw new ProductNotFoundError(params.destination.productId);
    }

    const result = await tx.query<unknown>(
      `INSERT INTO affiliate_destinations (
        id, workspace_id, product_id, label, url, network_name, status,
        created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, workspace_id, product_id, label, url, network_name, status,
                created_at, updated_at, version`,
      [
        params.destination.id,
        params.destination.workspaceId,
        params.destination.productId,
        params.destination.label,
        params.destination.url,
        params.destination.networkName,
        params.destination.status,
        params.destination.createdAt,
        params.destination.updatedAt,
        params.destination.version,
      ],
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      throw new DatabaseError('Failed to insert affiliate destination');
    }

    if (params.idempotencyRecord) {
      await insertIdempotencyRecord(tx, params.idempotencyRecord);
    }

    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent(params.auditEvent);

    return {
      destination: mapAffiliateDestinationRow(result.rows[0]),
      cached: false,
    };
  } catch (err) {
    if (
      err instanceof IdempotencyKeyReusedError ||
      err instanceof IdempotencyConflictError ||
      err instanceof ProductNotFoundError ||
      err instanceof AffiliateDestinationNotFoundError
    ) {
      throw err;
    }
    throw sanitizeDatabaseError(err);
  }
}
