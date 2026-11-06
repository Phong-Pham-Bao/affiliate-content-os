import {
  captureAuditEventSnapshot,
  IdempotencyConflictError,
  IdempotencyKeyReusedError,
  ProductNotFoundError,
  type CreateFactSetPersistenceParams,
  type CreateFactSetPersistenceResult,
} from '@affiliate-content-os/application';
import { DatabaseError, sanitizeDatabaseError } from '../database/errors.js';
import type { TransactionExecutor } from '../database/types.js';
import { createTransactionScopedPostgresAuditAdapter } from '../audit/index.js';
import { insertIdempotencyRecord } from '../tenancy/postgres-idempotency-adapter.js';
import { checkFactSetIdempotency } from './fact-set-create-idempotency.js';
import { mapProductFactRow, mapProductFactSetRow } from './mappers.js';

export async function executeCreateFactSetTransaction(
  tx: TransactionExecutor,
  params: CreateFactSetPersistenceParams,
): Promise<CreateFactSetPersistenceResult> {
  try {
    const cachedResult = await checkFactSetIdempotency(tx, params);
    if (cachedResult) {
      return cachedResult;
    }

    const prodLockResult = await tx.query<{ readonly id: string }>(
      `SELECT id FROM products WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [params.factSet.productId, params.factSet.workspaceId],
    );

    if (prodLockResult.rowCount === 0 || !prodLockResult.rows[0]) {
      throw new ProductNotFoundError(params.factSet.productId);
    }

    const revResult = await tx.query<{ readonly next_rev: string | number }>(
      `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_rev
       FROM product_fact_sets
       WHERE product_id = $1`,
      [params.factSet.productId],
    );

    const rawNextRev = revResult.rows[0]?.next_rev;
    let nextRev: number;
    if (typeof rawNextRev === 'number' && Number.isSafeInteger(rawNextRev) && rawNextRev >= 1) {
      nextRev = rawNextRev;
    } else if (typeof rawNextRev === 'string' && /^[1-9]\d*$/.test(rawNextRev)) {
      nextRev = Number.parseInt(rawNextRev, 10);
      if (!Number.isSafeInteger(nextRev) || nextRev < 1) {
        throw new DatabaseError('Corrupt database row: invalid next_rev');
      }
    } else {
      throw new DatabaseError('Corrupt database row: invalid next_rev type');
    }

    const fsResult = await tx.query<unknown>(
      `INSERT INTO product_fact_sets (
        id, workspace_id, product_id, revision_number, status, summary,
        created_by_user_id, confirmed_by_user_id, confirmed_at, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, workspace_id, product_id, revision_number, status, summary,
                created_by_user_id, confirmed_by_user_id, confirmed_at, created_at, updated_at, version`,
      [
        params.factSet.id,
        params.factSet.workspaceId,
        params.factSet.productId,
        nextRev,
        params.factSet.status,
        params.factSet.summary,
        params.factSet.createdByUserId,
        params.factSet.confirmedByUserId,
        params.factSet.confirmedAt,
        params.factSet.createdAt,
        params.factSet.updatedAt,
        params.factSet.version,
      ],
    );

    if (fsResult.rowCount === 0 || !fsResult.rows[0]) {
      throw new DatabaseError('Failed to insert product fact set');
    }

    const insertedFacts = [];
    for (const fact of params.facts) {
      const fResult = await tx.query<unknown>(
        `INSERT INTO product_facts (
          id, workspace_id, product_id, fact_set_id, fact_key, value_text,
          source_type, source_url, source_excerpt, confidence, claim_usage, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, workspace_id, product_id, fact_set_id, fact_key, value_text,
                  source_type, source_url, source_excerpt, confidence, claim_usage, created_at`,
        [
          fact.id,
          fact.workspaceId,
          fact.productId,
          params.factSet.id,
          fact.factKey,
          fact.valueText,
          fact.sourceType,
          fact.sourceUrl,
          fact.sourceExcerpt,
          fact.confidence,
          fact.claimUsage,
          fact.createdAt,
        ],
      );
      if (fResult.rowCount === 0 || !fResult.rows[0]) {
        throw new DatabaseError(`Failed to insert product fact: ${fact.factKey}`);
      }
      insertedFacts.push(mapProductFactRow(fResult.rows[0]));
    }

    if (params.idempotencyRecord) {
      await insertIdempotencyRecord(tx, params.idempotencyRecord);
    }

    const finalAuditEvent = captureAuditEventSnapshot({
      ...params.auditEvent,
      changes: {
        ...params.auditEvent.changes,
        revision_number: { before: null, after: String(nextRev) },
      },
    });
    const auditAdapter = createTransactionScopedPostgresAuditAdapter(tx);
    await auditAdapter.appendAuditEvent(finalAuditEvent);

    return {
      factSet: mapProductFactSetRow(fsResult.rows[0]),
      facts: insertedFacts,
      cached: false,
    };
  } catch (err) {
    if (
      err instanceof IdempotencyKeyReusedError ||
      err instanceof IdempotencyConflictError ||
      err instanceof ProductNotFoundError
    ) {
      throw err;
    }
    throw sanitizeDatabaseError(err);
  }
}
