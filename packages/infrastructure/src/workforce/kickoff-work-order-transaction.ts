import type pg from 'pg';
import {
  WorkforceAnalysisNotAcceptedError,
  type KickoffTransactionResult,
  type KickoffWorkOrderAtomicParams,
} from '@affiliate-content-os/application';
import { parseAnalysisId } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { checkKickoffIdempotency } from './kickoff-idempotency-check.js';
import { validateKickoffContext } from './kickoff-context-validation.js';
import { reserveKickoffBudget } from './kickoff-policy-reservation.js';
import { insertKickoffEntities } from './kickoff-work-order-row-inserts.js';
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
  const planningJobs = Object.freeze(
    (params.planningJobs ?? []).map((j) => Object.freeze({ ...j })),
  );

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
    planningJobs,
    totalEstimatedCostMicrounits: params.totalEstimatedCostMicrounits ?? 150_000,
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

  // 1. Transaction-scoped advisory lock and idempotency check
  const cachedResult = await checkKickoffIdempotency(client, snapshot);
  if (cachedResult) {
    return cachedResult;
  }

  // 2. Lock & revalidate product, fact set, source analyses, and hash
  await validateKickoffContext(client, snapshot);

  // 3. Lock & revalidate AI policy, rate limit, and reserve budget
  await reserveKickoffBudget(client, snapshot);

  // 4. Insert all workforce and planning job entities atomically
  const createdOrder = await insertKickoffEntities(client, snapshot, testHooks);

  return {
    workOrder: createdOrder,
    cached: false,
  };
}
