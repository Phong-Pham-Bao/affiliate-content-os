import crypto from 'node:crypto';
import type pg from 'pg';
import {
  IdempotencyKeyReusedError,
  ProductArchivedError,
  ProductNotFoundError,
  WorkforceAnalysisNotAcceptedError,
  WorkforceFactSetNotConfirmedError,
  WorkforceStaleContextError,
  type KickoffTransactionResult,
  type KickoffWorkOrderAtomicParams,
} from '@affiliate-content-os/application';
import { computeCanonicalContextHash } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import { insertKickoffEntities } from './kickoff-work-order-row-inserts.js';
import { mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';
import type { KickoffTestHooks } from './workforce-types.js';

export async function executeKickoffWorkOrderTransaction(
  client: pg.PoolClient,
  params: KickoffWorkOrderAtomicParams,
  testHooks?: KickoffTestHooks,
): Promise<KickoffTransactionResult> {
  const keyHash = new Uint8Array(params.idempotency.keyHash);
  const requestHash = new Uint8Array(params.idempotency.requestHash);
  const contextHash = new Uint8Array(params.contextPackage.contextHash);

  // 1. Transaction-scoped advisory lock for concurrency serialization on idempotency key
  const lockKey = computeIdempotencyAdvisoryLockKey(
    params.idempotency.principalId,
    params.idempotency.routeKey,
    keyHash,
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
      params.workOrder.workspaceId,
      params.idempotency.principalId,
      params.idempotency.routeKey,
      Buffer.from(keyHash),
    ],
  );

  if (idempCheck.rowCount !== 0 && idempCheck.rows[0]) {
    const rawRow = idempCheck.rows[0];
    const snapshot = validateAndMapIdempotencyRow(rawRow);

    const txTime = params.idempotency.createdAt
      ? Date.parse(params.idempotency.createdAt)
      : Date.now();
    const isExpired = Date.parse(snapshot.expiresAt) <= txTime;

    if (isExpired) {
      await client.query('DELETE FROM idempotency_keys WHERE id = $1', [snapshot.id]);
    } else {
      if (
        snapshot.requestHash.byteLength !== requestHash.byteLength ||
        !crypto.timingSafeEqual(snapshot.requestHash, requestHash)
      ) {
        throw new IdempotencyKeyReusedError();
      }

      const workOrderId = snapshot.resourceId;
      if (!workOrderId) {
        throw new DatabaseError(
          'Corrupt database row: missing work_order resourceId in idempotency record',
        );
      }

      const existingOrder = await client.query(
        `SELECT * FROM work_orders WHERE workspace_id = $1 AND id = $2`,
        [params.workOrder.workspaceId, workOrderId],
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
  }

  // 3. Lock & revalidate product
  const prodCheck = await client.query(
    `SELECT id, workspace_id, status, current_fact_set_id, version
     FROM products
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [params.workOrder.workspaceId, params.workOrder.productId],
  );

  if (prodCheck.rowCount === 0 || !prodCheck.rows[0]) {
    throw new ProductNotFoundError(params.workOrder.productId);
  }
  const productRow = prodCheck.rows[0];
  if (productRow.status === 'archived' || productRow.status !== 'active') {
    throw new ProductArchivedError();
  }
  if (productRow.current_fact_set_id !== params.contextPackage.factSetId) {
    throw new WorkforceFactSetNotConfirmedError(params.contextPackage.factSetId);
  }
  const lockedProductVersion = Number(productRow.version);
  if (lockedProductVersion !== params.contextPackage.productVersion) {
    throw new WorkforceStaleContextError(
      params.contextPackage.productVersion,
      lockedProductVersion,
    );
  }

  // 4. Lock & revalidate fact set
  const factSetCheck = await client.query(
    `SELECT id, workspace_id, product_id, status, version
     FROM product_fact_sets
     WHERE workspace_id = $1 AND product_id = $2 AND id = $3
     FOR UPDATE`,
    [params.workOrder.workspaceId, params.workOrder.productId, params.contextPackage.factSetId],
  );

  if (
    factSetCheck.rowCount === 0 ||
    !factSetCheck.rows[0] ||
    factSetCheck.rows[0].status !== 'confirmed'
  ) {
    throw new WorkforceFactSetNotConfirmedError(params.contextPackage.factSetId);
  }
  const factSetRow = factSetCheck.rows[0];
  const lockedFactSetVersion = Number(factSetRow.version);
  if (lockedFactSetVersion !== params.contextPackage.factSetVersion) {
    throw new WorkforceStaleContextError(
      params.contextPackage.factSetVersion,
      lockedFactSetVersion,
    );
  }

  // 5. Lock & revalidate source analyses
  const lockedAnalyses: { analysisId: string; version: number }[] = [];
  for (const expectedAnalysis of params.contextPackage.sourceAnalyses) {
    const analysisCheck = await client.query(
      `SELECT id, workspace_id, product_id, status, version
       FROM analyses
       WHERE workspace_id = $1 AND id = $2
       FOR UPDATE`,
      [params.workOrder.workspaceId, expectedAnalysis.id],
    );

    if (
      analysisCheck.rowCount === 0 ||
      !analysisCheck.rows[0] ||
      analysisCheck.rows[0].status !== 'accepted' ||
      analysisCheck.rows[0].product_id !== params.workOrder.productId ||
      analysisCheck.rows[0].workspace_id !== params.workOrder.workspaceId
    ) {
      throw new WorkforceAnalysisNotAcceptedError(expectedAnalysis.id);
    }

    const analysisRow = analysisCheck.rows[0];
    const lockedAnalysisVersion = Number(analysisRow.version);
    if (lockedAnalysisVersion !== expectedAnalysis.version) {
      throw new WorkforceStaleContextError(expectedAnalysis.version, lockedAnalysisVersion);
    }
    lockedAnalyses.push({ analysisId: expectedAnalysis.id, version: lockedAnalysisVersion });
  }

  // 6. Recompute and verify the canonical SHA-256 context hash from locked rows
  const canonicalHash = computeCanonicalContextHash({
    workspaceId: params.workOrder.workspaceId,
    productId: params.workOrder.productId,
    productVersion: lockedProductVersion,
    factSetId: params.contextPackage.factSetId,
    factSetVersion: lockedFactSetVersion,
    analyses: lockedAnalyses,
    schemaVersion: params.contextPackage.contextSchemaVersion,
  });

  if (
    canonicalHash.byteLength !== contextHash.byteLength ||
    !crypto.timingSafeEqual(canonicalHash, contextHash)
  ) {
    throw new WorkforceStaleContextError(
      params.contextPackage.productVersion,
      lockedProductVersion,
    );
  }

  // 7. Insert all workforce entities atomically
  const createdOrder = await insertKickoffEntities(client, params, testHooks);

  return {
    workOrder: createdOrder,
    cached: false,
  };
}
