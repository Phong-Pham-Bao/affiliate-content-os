import type pg from 'pg';
import {
  IdempotencyKeyReusedError,
  ProductArchivedError,
  ProductNotFoundError,
  WorkforceAnalysisNotAcceptedError,
  WorkforceFactSetNotConfirmedError,
  type KickoffTransactionResult,
  type KickoffWorkOrderAtomicParams,
} from '@affiliate-content-os/application';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import { insertKickoffEntities } from './kickoff-work-order-row-inserts.js';
import { mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';

export async function executeKickoffWorkOrderTransaction(
  client: pg.PoolClient,
  params: KickoffWorkOrderAtomicParams,
): Promise<KickoffTransactionResult> {
  // 1. Transaction-scoped advisory lock for concurrency serialization on idempotency key
  const lockKey = computeIdempotencyAdvisoryLockKey(
    params.idempotency.principalId,
    params.idempotency.routeKey,
    params.idempotency.keyHash,
  );
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

  // 2. Check idempotency record
  const idempCheck = await client.query(
    `SELECT request_hash, response_json, resource_id
     FROM idempotency_keys
     WHERE workspace_id = $1 AND principal_id = $2 AND route_key = $3 AND key_hash = $4
     FOR UPDATE`,
    [
      params.workOrder.workspaceId,
      params.idempotency.principalId,
      params.idempotency.routeKey,
      Buffer.from(params.idempotency.keyHash),
    ],
  );

  if (idempCheck.rows.length > 0) {
    const existing = idempCheck.rows[0];
    const existingReqHash = Buffer.isBuffer(existing.request_hash)
      ? new Uint8Array(existing.request_hash)
      : existing.request_hash;

    const matches =
      Buffer.compare(Buffer.from(existingReqHash), Buffer.from(params.idempotency.requestHash)) ===
      0;

    if (!matches) {
      throw new IdempotencyKeyReusedError();
    }

    const existingOrder = await client.query(
      `SELECT * FROM work_orders WHERE workspace_id = $1 AND id = $2`,
      [params.workOrder.workspaceId, existing.resource_id],
    );

    if (existingOrder.rows.length > 0) {
      return {
        workOrder: mapWorkOrderRowToSummaryDTO(existingOrder.rows[0]),
        cached: true,
      };
    }

    const resp =
      typeof existing.response_json === 'string'
        ? JSON.parse(existing.response_json)
        : existing.response_json;
    return {
      workOrder: resp,
      cached: true,
    };
  }

  // 3. Lock & revalidate product
  const prodCheck = await client.query(
    `SELECT id, status, current_fact_set_id, version
     FROM products
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [params.workOrder.workspaceId, params.workOrder.productId],
  );

  if (prodCheck.rows.length === 0) {
    throw new ProductNotFoundError(params.workOrder.productId);
  }
  const productRow = prodCheck.rows[0];
  if (productRow.status === 'archived') {
    throw new ProductArchivedError();
  }
  if (productRow.current_fact_set_id !== params.contextPackage.factSetId) {
    throw new WorkforceFactSetNotConfirmedError(params.contextPackage.factSetId);
  }

  // 4. Lock & revalidate fact set
  const factSetCheck = await client.query(
    `SELECT id, status, version
     FROM product_fact_sets
     WHERE workspace_id = $1 AND product_id = $2 AND id = $3
     FOR UPDATE`,
    [params.workOrder.workspaceId, params.workOrder.productId, params.contextPackage.factSetId],
  );

  if (factSetCheck.rows.length === 0 || factSetCheck.rows[0].status !== 'confirmed') {
    throw new WorkforceFactSetNotConfirmedError(params.contextPackage.factSetId);
  }

  // 5. Lock & revalidate source analyses
  for (const analysisId of params.sourceAnalysisIds) {
    const analysisCheck = await client.query(
      `SELECT id, status, product_id, version
       FROM analyses
       WHERE workspace_id = $1 AND id = $2
       FOR UPDATE`,
      [params.workOrder.workspaceId, analysisId],
    );

    if (
      analysisCheck.rows.length === 0 ||
      analysisCheck.rows[0].status !== 'accepted' ||
      analysisCheck.rows[0].product_id !== params.workOrder.productId
    ) {
      throw new WorkforceAnalysisNotAcceptedError(analysisId);
    }
  }

  // 6. Insert all workforce entities atomically
  const createdOrder = await insertKickoffEntities(client, params);

  return {
    workOrder: createdOrder,
    cached: false,
  };
}
