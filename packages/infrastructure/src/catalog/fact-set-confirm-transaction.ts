import {
  FactSetNotFoundError,
  ProductNotFoundError,
  type ConfirmFactSetPersistenceParams,
  type ConfirmFactSetPersistenceResult,
} from '@affiliate-content-os/application';
import { DatabaseError, sanitizeDatabaseError } from '../database/errors.js';
import type { TransactionExecutor } from '../database/types.js';
import { createTransactionScopedPostgresAuditAdapter } from '../audit/index.js';
import { mapProductFactSetRow, mapProductRow } from './mappers.js';

export async function executeConfirmFactSetTransaction(
  tx: TransactionExecutor,
  params: ConfirmFactSetPersistenceParams,
): Promise<ConfirmFactSetPersistenceResult> {
  try {
    const checkResult = await tx.query<unknown>(
      `SELECT id, workspace_id, product_id, revision_number, status, summary,
              created_by_user_id, confirmed_by_user_id, confirmed_at, created_at, updated_at, version
       FROM product_fact_sets
       WHERE id = $1 AND product_id = $2 AND workspace_id = $3
       FOR UPDATE`,
      [params.factSetId, params.productId, params.workspaceId],
    );

    if (checkResult.rowCount === 0 || !checkResult.rows[0]) {
      throw new FactSetNotFoundError(params.factSetId);
    }

    const currentFactSet = mapProductFactSetRow(checkResult.rows[0]);

    if (currentFactSet.status === 'confirmed') {
      const prodResult = await tx.query<unknown>(
        `SELECT id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
                category, description, audience_notes, allowed_claims_notes, prohibited_claims_notes,
                status, current_fact_set_id, created_at, updated_at, version
         FROM products
         WHERE id = $1 AND workspace_id = $2`,
        [params.productId, params.workspaceId],
      );
      if (prodResult.rowCount === 0 || !prodResult.rows[0]) {
        throw new ProductNotFoundError(params.productId);
      }
      return {
        factSet: currentFactSet,
        product: mapProductRow(prodResult.rows[0]),
        alreadyConfirmed: true,
      };
    }

    const fsUpdateResult = await tx.query<unknown>(
      `UPDATE product_fact_sets
       SET status = 'confirmed',
           confirmed_by_user_id = $1,
           confirmed_at = $2,
           updated_at = $2,
           version = version + 1
       WHERE id = $3 AND product_id = $4 AND workspace_id = $5 AND status = 'proposed'
       RETURNING id, workspace_id, product_id, revision_number, status, summary,
                 created_by_user_id, confirmed_by_user_id, confirmed_at, created_at, updated_at, version`,
      [
        params.confirmedByUserId,
        params.confirmedAt,
        params.factSetId,
        params.productId,
        params.workspaceId,
      ],
    );

    if (fsUpdateResult.rowCount === 0 || !fsUpdateResult.rows[0]) {
      throw new DatabaseError(`Failed to update fact set status to confirmed: ${params.factSetId}`);
    }

    const prodUpdateResult = await tx.query<unknown>(
      `UPDATE products
       SET current_fact_set_id = $1,
           updated_at = $2,
           version = version + 1
       WHERE id = $3 AND workspace_id = $4
       RETURNING id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
                 category, description, audience_notes, allowed_claims_notes, prohibited_claims_notes,
                 status, current_fact_set_id, created_at, updated_at, version`,
      [params.factSetId, params.confirmedAt, params.productId, params.workspaceId],
    );

    if (prodUpdateResult.rowCount === 0 || !prodUpdateResult.rows[0]) {
      throw new ProductNotFoundError(params.productId);
    }

    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent(params.auditEvent);

    return {
      factSet: mapProductFactSetRow(fsUpdateResult.rows[0]),
      product: mapProductRow(prodUpdateResult.rows[0]),
      alreadyConfirmed: false,
    };
  } catch (err) {
    if (err instanceof FactSetNotFoundError || err instanceof ProductNotFoundError) {
      throw err;
    }
    throw sanitizeDatabaseError(err);
  }
}
