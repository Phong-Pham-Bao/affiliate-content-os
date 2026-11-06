import crypto from 'node:crypto';
import type {
  ListProductsPersistenceParams,
  ListProductsPersistenceResult,
} from '@affiliate-content-os/application';
import type { ProductId, ProductSnapshot } from '@affiliate-content-os/domain';
import { sanitizeDatabaseError } from '../database/errors.js';
import type { Database } from '../database/types.js';
import { mapProductRow } from './mappers.js';

export {
  queryAffiliateDestinationById,
  queryFactSetById,
  queryListAffiliateDestinations,
  queryListFactSets,
} from './catalog-item-queries.js';

export function computeProductUrlAdvisoryLockKey(
  workspaceId: string,
  canonicalUrlHash: Uint8Array,
): string {
  const hash = crypto.createHash('sha256');
  hash.update('product_url_lock:');
  hash.update(workspaceId);
  hash.update(':');
  hash.update(Buffer.from(canonicalUrlHash));
  const digest = hash.digest();
  return digest.readBigInt64BE(0).toString();
}

const PRODUCT_COLS = `id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
  category, description, audience_notes, allowed_claims_notes, prohibited_claims_notes,
  status, current_fact_set_id, created_at, updated_at, version`;

export async function queryProductById(
  db: Database,
  workspaceId: string,
  productId: ProductId,
): Promise<ProductSnapshot | null> {
  try {
    const res = await db.query<unknown>(
      `SELECT ${PRODUCT_COLS} FROM products WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, productId],
    );
    return res.rowCount && res.rows[0] ? mapProductRow(res.rows[0]) : null;
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to query product by id');
  }
}

export async function queryProductByCanonicalUrlHash(
  db: Database,
  workspaceId: string,
  canonicalUrlHash: Uint8Array,
  excludeProductId?: ProductId | undefined,
): Promise<ProductSnapshot | null> {
  try {
    const res = await db.query<unknown>(
      `SELECT ${PRODUCT_COLS} FROM products
       WHERE workspace_id = $1 AND canonical_url_hash = $2
         AND ($3::uuid IS NULL OR id <> $3) LIMIT 1`,
      [workspaceId, Buffer.from(canonicalUrlHash), excludeProductId ?? null],
    );
    return res.rowCount && res.rows[0] ? mapProductRow(res.rows[0]) : null;
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to query product by url hash');
  }
}

export async function queryListProducts(
  db: Database,
  params: ListProductsPersistenceParams,
): Promise<ListProductsPersistenceResult> {
  try {
    const fetchLimit = params.limit + 1;
    const res = await db.query<unknown>(
      `SELECT ${PRODUCT_COLS} FROM products
       WHERE workspace_id = $1
         AND ($2::text IS NULL OR status = $2)
         AND (($3::timestamptz IS NULL) OR (updated_at < $3 OR (updated_at = $3 AND id < $4)))
       ORDER BY updated_at DESC, id DESC
       LIMIT $5`,
      [
        params.workspaceId,
        params.status ?? null,
        params.cursor?.updatedAt ?? null,
        params.cursor?.id ?? null,
        fetchLimit,
      ],
    );

    const hasMore = res.rows.length > params.limit;
    const rows = hasMore ? res.rows.slice(0, params.limit) : res.rows;
    const items = rows.map(mapProductRow);

    let nextCursor = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!;
      nextCursor = { updatedAt: last.updatedAt, id: last.id };
    }

    return { items, nextCursor };
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to list products');
  }
}
