import crypto from 'node:crypto';
import {
  IdempotencyConflictError,
  IdempotencyKeyReusedError,
  ProductNotFoundError,
  StaleVersionConflictError,
  type CreateProductPersistenceParams,
  type CreateProductPersistenceResult,
} from '@affiliate-content-os/application';
import { DatabaseError, sanitizeDatabaseError } from '../database/errors.js';
import type { TransactionExecutor } from '../database/types.js';
import { createTransactionScopedPostgresAuditAdapter } from '../audit/index.js';
import {
  computeIdempotencyAdvisoryLockKey,
  insertIdempotencyRecord,
} from '../tenancy/postgres-idempotency-adapter.js';
import { computeProductUrlAdvisoryLockKey } from './catalog-queries.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { mapProductRow } from './mappers.js';

export async function executeCreateProductTransaction(
  tx: TransactionExecutor,
  params: CreateProductPersistenceParams,
): Promise<CreateProductPersistenceResult> {
  try {
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
        params.product.workspaceId,
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

        const productId = snapshot.resourceId;
        if (!productId) {
          throw new DatabaseError('Idempotency row missing product resourceId');
        }

        const prodResult = await tx.query<unknown>(
          `SELECT id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
                  category, description, audience_notes, allowed_claims_notes, prohibited_claims_notes,
                  status, current_fact_set_id, created_at, updated_at, version
           FROM products
           WHERE workspace_id = $1 AND id = $2`,
          [params.product.workspaceId, productId],
        );

        if (prodResult.rowCount === 0 || !prodResult.rows[0]) {
          throw new DatabaseError(
            `Persisted product not found for cached idempotency: ${productId}`,
          );
        }

        const replayedProduct = mapProductRow(prodResult.rows[0]);

        let duplicateWarning = false;
        if (
          snapshot.responseJson &&
          typeof snapshot.responseJson === 'object' &&
          typeof (snapshot.responseJson as Record<string, unknown>)['duplicateWarning'] ===
            'boolean'
        ) {
          duplicateWarning = (snapshot.responseJson as Record<string, unknown>)[
            'duplicateWarning'
          ] as boolean;
        } else {
          const dupCheck = await tx.query<{ readonly id: string }>(
            `SELECT id FROM products WHERE workspace_id = $1 AND canonical_url_hash = $2 AND id <> $3 LIMIT 1`,
            [
              params.product.workspaceId,
              Buffer.from(replayedProduct.canonicalUrlHash),
              replayedProduct.id,
            ],
          );
          duplicateWarning = dupCheck.rowCount !== null && dupCheck.rowCount > 0;
        }

        return {
          product: replayedProduct,
          idempotencyRecord: snapshot,
          duplicateWarning,
          cached: true,
        };
      }
    }

    const urlLockKey = computeProductUrlAdvisoryLockKey(
      params.product.workspaceId,
      params.product.canonicalUrlHash,
    );
    await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [urlLockKey]);

    const dupCheckResult = await tx.query<{ readonly id: string }>(
      `SELECT id FROM products WHERE workspace_id = $1 AND canonical_url_hash = $2 LIMIT 1`,
      [params.product.workspaceId, Buffer.from(params.product.canonicalUrlHash)],
    );
    const duplicateWarning = dupCheckResult.rowCount !== null && dupCheckResult.rowCount > 0;

    await tx.query(
      `INSERT INTO products (
        id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
        category, description, audience_notes, allowed_claims_notes, prohibited_claims_notes,
        status, current_fact_set_id, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        params.product.id,
        params.product.workspaceId,
        params.product.name,
        params.product.merchantName,
        params.product.canonicalUrl,
        Buffer.from(params.product.canonicalUrlHash),
        params.product.category,
        params.product.description,
        params.product.audienceNotes,
        params.product.allowedClaimsNotes,
        params.product.prohibitedClaimsNotes,
        params.product.status,
        params.product.currentFactSetId,
        params.product.createdAt,
        params.product.updatedAt,
        params.product.version,
      ],
    );

    const authoritativeResponseJson = Object.freeze({
      id: params.product.id,
      name: params.product.name,
      status: params.product.status,
      duplicateWarning,
    });

    const authoritativeIdempotencyRecord = Object.freeze({
      ...params.idempotencyRecord,
      responseJson: authoritativeResponseJson,
    });

    await insertIdempotencyRecord(tx, authoritativeIdempotencyRecord);

    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent(params.auditEvent);

    return {
      product: params.product,
      idempotencyRecord: authoritativeIdempotencyRecord,
      duplicateWarning,
      cached: false,
    };
  } catch (err) {
    if (
      err instanceof IdempotencyKeyReusedError ||
      err instanceof IdempotencyConflictError ||
      err instanceof ProductNotFoundError ||
      err instanceof StaleVersionConflictError
    ) {
      throw err;
    }
    throw sanitizeDatabaseError(err);
  }
}
