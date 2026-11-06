import {
  AffiliateDestinationNotFoundError,
  StaleVersionConflictError,
  type ArchiveAffiliateDestinationPersistenceParams,
  type ArchiveAffiliateDestinationPersistenceResult,
  type UpdateAffiliateDestinationPersistenceParams,
} from '@affiliate-content-os/application';
import type { AffiliateDestinationSnapshot } from '@affiliate-content-os/domain';
import { DatabaseError, sanitizeDatabaseError } from '../database/errors.js';
import type { TransactionExecutor } from '../database/types.js';
import { createTransactionScopedPostgresAuditAdapter } from '../audit/index.js';
import { isProxySafe, validateSafeVersion } from './mapper-helpers.js';
import { mapAffiliateDestinationRow } from './mappers.js';

export async function executeUpdateAffiliateTransaction(
  tx: TransactionExecutor,
  params: UpdateAffiliateDestinationPersistenceParams,
): Promise<AffiliateDestinationSnapshot> {
  try {
    const updateResult = await tx.query<unknown>(
      `UPDATE affiliate_destinations
       SET label = $1,
           url = $2,
           network_name = $3,
           updated_at = $4,
           version = version + 1
       WHERE id = $5 AND product_id = $6 AND workspace_id = $7 AND version = $8
       RETURNING id, workspace_id, product_id, label, url, network_name, status,
                 created_at, updated_at, version`,
      [
        params.updates.label,
        params.updates.url,
        params.updates.networkName,
        params.updates.updatedAt,
        params.destinationId,
        params.productId,
        params.workspaceId,
        params.expectedVersion,
      ],
    );

    if (updateResult.rowCount === 0 || !updateResult.rows[0]) {
      const checkResult = await tx.query<unknown>(
        `SELECT version FROM affiliate_destinations
         WHERE id = $1 AND product_id = $2 AND workspace_id = $3`,
        [params.destinationId, params.productId, params.workspaceId],
      );

      if (checkResult.rowCount === 0 || !checkResult.rows[0]) {
        throw new AffiliateDestinationNotFoundError(params.destinationId);
      }

      const row = checkResult.rows[0];
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

    return mapAffiliateDestinationRow(updateResult.rows[0]);
  } catch (err) {
    if (
      err instanceof AffiliateDestinationNotFoundError ||
      err instanceof StaleVersionConflictError
    ) {
      throw err;
    }
    throw sanitizeDatabaseError(err);
  }
}

export async function executeArchiveAffiliateTransaction(
  tx: TransactionExecutor,
  params: ArchiveAffiliateDestinationPersistenceParams,
): Promise<ArchiveAffiliateDestinationPersistenceResult> {
  try {
    const updateResult = await tx.query<unknown>(
      `UPDATE affiliate_destinations
       SET status = 'archived',
           updated_at = $1,
           version = version + 1
       WHERE id = $2 AND product_id = $3 AND workspace_id = $4 AND status <> 'archived'
       RETURNING id, workspace_id, product_id, label, url, network_name, status,
                 created_at, updated_at, version`,
      [params.updatedAt, params.destinationId, params.productId, params.workspaceId],
    );

    if (updateResult.rowCount === 0 || !updateResult.rows[0]) {
      const checkResult = await tx.query<unknown>(
        `SELECT id, workspace_id, product_id, label, url, network_name, status,
                created_at, updated_at, version
         FROM affiliate_destinations
         WHERE id = $1 AND product_id = $2 AND workspace_id = $3`,
        [params.destinationId, params.productId, params.workspaceId],
      );

      if (checkResult.rowCount === 0 || !checkResult.rows[0]) {
        throw new AffiliateDestinationNotFoundError(params.destinationId);
      }

      const existingDestination = mapAffiliateDestinationRow(checkResult.rows[0]);
      if (existingDestination.status === 'archived') {
        return {
          destination: existingDestination,
          alreadyArchived: true,
        };
      }

      throw new DatabaseError(
        `Unexpected archive state for affiliate destination ${params.destinationId}`,
      );
    }

    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent(params.auditEvent);

    return {
      destination: mapAffiliateDestinationRow(updateResult.rows[0]),
      alreadyArchived: false,
    };
  } catch (err) {
    if (
      err instanceof AffiliateDestinationNotFoundError ||
      err instanceof StaleVersionConflictError
    ) {
      throw err;
    }
    throw sanitizeDatabaseError(err);
  }
}
