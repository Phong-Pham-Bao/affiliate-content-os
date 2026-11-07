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
import { computeCanonicalContextHash, parseAnalysisId } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import {
  validateAndMapIdempotencyRow,
  type RawIdempotencyRow,
} from '../tenancy/idempotency-row-mapper.js';
import { computeIdempotencyAdvisoryLockKey } from '../tenancy/postgres-idempotency-adapter.js';
import { insertKickoffEntities } from './kickoff-work-order-row-inserts.js';
import { mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';
import type { KickoffPersistenceSnapshot, KickoffTestHooks } from './workforce-types.js';

export function createKickoffPersistenceSnapshot(
  params: KickoffWorkOrderAtomicParams,
): KickoffPersistenceSnapshot {
  if (typeof params !== 'object' || params === null) {
    throw new DatabaseError('Invalid kickoff parameters');
  }

  // Synchronously clone byte arrays and create immutable Buffers
  const keyHash = new Uint8Array(params.idempotency.keyHash);
  const requestHash = new Uint8Array(params.idempotency.requestHash);
  const contextHash = new Uint8Array(params.contextPackage.contextHash);

  const keyHashBuf = Buffer.from(keyHash);
  const requestHashBuf = Buffer.from(requestHash);
  const contextHashBuf = Buffer.from(contextHash);

  // Normalize and copy source analyses once
  const rawAnalyses = params.contextPackage.sourceAnalyses;
  if (!Array.isArray(rawAnalyses)) {
    throw new DatabaseError('Invalid sourceAnalyses collection in kickoff parameters');
  }
  const uniqueAnalyses = new Map<string, number>();
  for (const a of rawAnalyses) {
    if (typeof a?.id !== 'string' || typeof a?.version !== 'number') {
      throw new DatabaseError('Invalid source analysis descriptor item');
    }
    uniqueAnalyses.set(a.id, a.version);
  }
  const normalizedSourceAnalyses = Object.freeze(
    Array.from(uniqueAnalyses.entries())
      .map(([id, version]) =>
        Object.freeze({
          id: parseAnalysisId(id),
          version,
        }),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

  // Fail closed if redundant/legacy sourceAnalysisIds is supplied and does not match normalized sourceAnalyses
  const untypedSourceIds = (params as { sourceAnalysisIds?: readonly string[] }).sourceAnalysisIds;
  if (untypedSourceIds !== undefined) {
    const verifiedIds: readonly string[] = normalizedSourceAnalyses.map((a) => a.id);
    const sortedUntyped = [...new Set(untypedSourceIds)].sort();
    if (
      sortedUntyped.length !== verifiedIds.length ||
      !sortedUntyped.every((id, idx) => id === verifiedIds[idx])
    ) {
      const offendingId =
        untypedSourceIds.find((id) => !verifiedIds.includes(id)) ?? untypedSourceIds[0] ?? '';
      throw new WorkforceAnalysisNotAcceptedError(offendingId);
    }
  }

  // Freeze immutable collections
  const workItems = Object.freeze(params.workItems.map((item) => Object.freeze({ ...item })));
  const assignments = Object.freeze(params.assignments.map((a) => Object.freeze({ ...a })));
  const dependencies = Object.freeze(params.dependencies.map((d) => Object.freeze({ ...d })));

  return Object.freeze({
    workOrder: Object.freeze({ ...params.workOrder }),
    contextPackage: Object.freeze({
      ...params.contextPackage,
      contextHash,
      contextHashBuf,
      sourceAnalyses: normalizedSourceAnalyses,
    }),
    workItems,
    assignments,
    dependencies,
    idempotency: Object.freeze({
      ...params.idempotency,
      keyHash,
      keyHashBuf,
      requestHash,
      requestHashBuf,
    }),
    auditEvent: Object.freeze({
      ...params.auditEvent,
      changesJson: Object.freeze({ ...params.auditEvent.changesJson }),
    }),
  });
}

export async function executeKickoffWorkOrderTransaction(
  client: pg.PoolClient,
  params: KickoffWorkOrderAtomicParams,
  testHooks?: KickoffTestHooks,
): Promise<KickoffTransactionResult> {
  const snapshot = createKickoffPersistenceSnapshot(params);

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

    // Query authoritative PostgreSQL transaction timestamp inside the transaction
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
    } else {
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
  }

  // 3. Lock & revalidate product
  const prodCheck = await client.query(
    `SELECT id, workspace_id, status, current_fact_set_id, version
     FROM products
     WHERE workspace_id = $1 AND id = $2
     FOR UPDATE`,
    [snapshot.workOrder.workspaceId, snapshot.workOrder.productId],
  );

  if (prodCheck.rowCount === 0 || !prodCheck.rows[0]) {
    throw new ProductNotFoundError(snapshot.workOrder.productId);
  }
  const productRow = prodCheck.rows[0];
  if (productRow.status === 'archived' || productRow.status !== 'active') {
    throw new ProductArchivedError();
  }
  if (productRow.current_fact_set_id !== snapshot.contextPackage.factSetId) {
    throw new WorkforceFactSetNotConfirmedError(snapshot.contextPackage.factSetId);
  }
  const lockedProductVersion = Number(productRow.version);
  if (lockedProductVersion !== snapshot.contextPackage.productVersion) {
    throw new WorkforceStaleContextError(
      snapshot.contextPackage.productVersion,
      lockedProductVersion,
    );
  }

  // 4. Lock & revalidate fact set
  const factSetCheck = await client.query(
    `SELECT id, workspace_id, product_id, status, version
     FROM product_fact_sets
     WHERE workspace_id = $1 AND product_id = $2 AND id = $3
     FOR UPDATE`,
    [
      snapshot.workOrder.workspaceId,
      snapshot.workOrder.productId,
      snapshot.contextPackage.factSetId,
    ],
  );

  if (
    factSetCheck.rowCount === 0 ||
    !factSetCheck.rows[0] ||
    factSetCheck.rows[0].status !== 'confirmed'
  ) {
    throw new WorkforceFactSetNotConfirmedError(snapshot.contextPackage.factSetId);
  }
  const factSetRow = factSetCheck.rows[0];
  const lockedFactSetVersion = Number(factSetRow.version);
  if (lockedFactSetVersion !== snapshot.contextPackage.factSetVersion) {
    throw new WorkforceStaleContextError(
      snapshot.contextPackage.factSetVersion,
      lockedFactSetVersion,
    );
  }

  // 5. Lock & revalidate source analyses
  const lockedAnalyses: { analysisId: string; version: number }[] = [];
  for (const expectedAnalysis of snapshot.contextPackage.sourceAnalyses) {
    const analysisCheck = await client.query(
      `SELECT id, workspace_id, product_id, status, version
       FROM analyses
       WHERE workspace_id = $1 AND id = $2
       FOR UPDATE`,
      [snapshot.workOrder.workspaceId, expectedAnalysis.id],
    );

    if (
      analysisCheck.rowCount === 0 ||
      !analysisCheck.rows[0] ||
      analysisCheck.rows[0].status !== 'accepted' ||
      analysisCheck.rows[0].product_id !== snapshot.workOrder.productId ||
      analysisCheck.rows[0].workspace_id !== snapshot.workOrder.workspaceId
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
    workspaceId: snapshot.workOrder.workspaceId,
    productId: snapshot.workOrder.productId,
    productVersion: lockedProductVersion,
    factSetId: snapshot.contextPackage.factSetId,
    factSetVersion: lockedFactSetVersion,
    analyses: lockedAnalyses,
    schemaVersion: snapshot.contextPackage.contextSchemaVersion,
  });

  if (
    canonicalHash.byteLength !== snapshot.contextPackage.contextHash.byteLength ||
    !crypto.timingSafeEqual(canonicalHash, snapshot.contextPackage.contextHash)
  ) {
    throw new WorkforceStaleContextError(
      snapshot.contextPackage.productVersion,
      lockedProductVersion,
    );
  }

  // 7. Insert all workforce entities atomically using the verified snapshot
  const createdOrder = await insertKickoffEntities(client, snapshot, testHooks);

  return {
    workOrder: createdOrder,
    cached: false,
  };
}
