import {
  ProductNotFoundError,
  StaleVersionConflictError,
  type ArchiveProductPersistenceParams,
  type ArchiveProductPersistenceResult,
  type UpdateProductPersistenceParams,
  type UpdateProductPersistenceResult,
} from '@affiliate-content-os/application';
import { DatabaseError, sanitizeDatabaseError } from '../database/errors.js';
import type { TransactionExecutor } from '../database/types.js';
import { createTransactionScopedPostgresAuditAdapter } from '../audit/index.js';
import { computeProductUrlAdvisoryLockKey } from './catalog-queries.js';
import { isProxySafe, validateSafeVersion } from './mapper-helpers.js';
import { mapProductRow } from './mappers.js';

export async function executeUpdateProductTransaction(
  tx: TransactionExecutor,
  params: UpdateProductPersistenceParams,
): Promise<UpdateProductPersistenceResult> {
  try {
    const urlLockKey = computeProductUrlAdvisoryLockKey(
      params.workspaceId,
      params.updates.canonicalUrlHash,
    );
    await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [urlLockKey]);

    const dupCheckResult = await tx.query<{ readonly id: string }>(
      `SELECT id FROM products WHERE workspace_id = $1 AND canonical_url_hash = $2 AND id <> $3 LIMIT 1`,
      [params.workspaceId, Buffer.from(params.updates.canonicalUrlHash), params.productId],
    );
    const duplicateWarning = dupCheckResult.rowCount !== null && dupCheckResult.rowCount > 0;

    const updateResult = await tx.query<unknown>(
      `UPDATE products
       SET name = $1,
           merchant_name = $2,
           canonical_url = $3,
           canonical_url_hash = $4,
           category = $5,
           description = $6,
           audience_notes = $7,
           allowed_claims_notes = $8,
           prohibited_claims_notes = $9,
           status = $10,
           updated_at = $11,
           version = version + 1
       WHERE id = $12 AND workspace_id = $13 AND version = $14
       RETURNING id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
                 category, description, audience_notes, allowed_claims_notes, prohibited_claims_notes,
                 status, current_fact_set_id, created_at, updated_at, version`,
      [
        params.updates.name,
        params.updates.merchantName,
        params.updates.canonicalUrl,
        Buffer.from(params.updates.canonicalUrlHash),
        params.updates.category,
        params.updates.description,
        params.updates.audienceNotes,
        params.updates.allowedClaimsNotes,
        params.updates.prohibitedClaimsNotes,
        params.updates.status,
        params.updates.updatedAt,
        params.productId,
        params.workspaceId,
        params.expectedVersion,
      ],
    );

    if (updateResult.rowCount === 0 || !updateResult.rows[0]) {
      const existingResult = await tx.query<unknown>(
        `SELECT version FROM products WHERE id = $1 AND workspace_id = $2`,
        [params.productId, params.workspaceId],
      );
      if (existingResult.rowCount === 0 || !existingResult.rows[0]) {
        throw new ProductNotFoundError(params.productId);
      }
      const row = existingResult.rows[0];
      if (typeof row !== 'object' || row === null || isProxySafe(row)) {
        throw new DatabaseError('Corrupt database row: invalid row structure');
      }
      const desc = Object.getOwnPropertyDescriptor(row, 'version');
      if (!desc || desc.get !== undefined || desc.set !== undefined) {
        throw new DatabaseError('Corrupt database row: invalid version descriptor');
      }
      const currentVer = validateSafeVersion(desc.value, 'version');
      throw new StaleVersionConflictError(params.expectedVersion, currentVer);
    }

    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent(params.auditEvent);

    return {
      product: mapProductRow(updateResult.rows[0]),
      duplicateWarning,
    };
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof StaleVersionConflictError) {
      throw err;
    }
    throw sanitizeDatabaseError(err);
  }
}

export async function executeArchiveProductTransaction(
  tx: TransactionExecutor,
  params: ArchiveProductPersistenceParams,
): Promise<ArchiveProductPersistenceResult> {
  try {
    const updateResult = await tx.query<unknown>(
      `UPDATE products
       SET status = 'archived',
           updated_at = $1,
           version = version + 1
       WHERE id = $2 AND workspace_id = $3 AND status <> 'archived'
       RETURNING id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
                 category, description, audience_notes, allowed_claims_notes, prohibited_claims_notes,
                 status, current_fact_set_id, created_at, updated_at, version`,
      [params.updatedAt, params.productId, params.workspaceId],
    );

    if (updateResult.rowCount === 0 || !updateResult.rows[0]) {
      const checkResult = await tx.query<unknown>(
        `SELECT id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
                category, description, audience_notes, allowed_claims_notes, prohibited_claims_notes,
                status, current_fact_set_id, created_at, updated_at, version
         FROM products
         WHERE id = $1 AND workspace_id = $2`,
        [params.productId, params.workspaceId],
      );

      if (checkResult.rowCount === 0 || !checkResult.rows[0]) {
        throw new ProductNotFoundError(params.productId);
      }

      const existingProduct = mapProductRow(checkResult.rows[0]);
      if (existingProduct.status === 'archived') {
        return {
          product: existingProduct,
          alreadyArchived: true,
        };
      }

      throw new DatabaseError(`Unexpected archive state for product ${params.productId}`);
    }

    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent(params.auditEvent);

    return {
      product: mapProductRow(updateResult.rows[0]),
      alreadyArchived: false,
    };
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof StaleVersionConflictError) {
      throw err;
    }
    throw sanitizeDatabaseError(err);
  }
}
