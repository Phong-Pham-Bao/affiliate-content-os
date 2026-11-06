import type {
  FactSetWithFacts,
  ListAffiliateDestinationsPersistenceParams,
  ListAffiliateDestinationsPersistenceResult,
  ListFactSetsPersistenceParams,
  ListFactSetsPersistenceResult,
} from '@affiliate-content-os/application';
import type {
  AffiliateDestinationId,
  AffiliateDestinationSnapshot,
  ProductId,
} from '@affiliate-content-os/domain';
import { sanitizeDatabaseError } from '../database/errors.js';
import type { Database } from '../database/types.js';
import { mapAffiliateDestinationRow, mapProductFactRow, mapProductFactSetRow } from './mappers.js';

const FACT_SET_COLS = `id, workspace_id, product_id, revision_number, status, summary,
  created_by_user_id, confirmed_by_user_id, confirmed_at, created_at, updated_at, version`;

const FACT_COLS = `id, workspace_id, product_id, fact_set_id, fact_key, value_text,
  source_type, source_url, source_excerpt, confidence, claim_usage, created_at`;

const AFFILIATE_COLS = `id, workspace_id, product_id, label, url, network_name, status,
  created_at, updated_at, version`;

export async function queryFactSetById(
  db: Database,
  workspaceId: string,
  productId: ProductId,
  factSetId: string,
): Promise<FactSetWithFacts | null> {
  try {
    const fsRes = await db.query<unknown>(
      `SELECT ${FACT_SET_COLS} FROM product_fact_sets
       WHERE workspace_id = $1 AND product_id = $2 AND id = $3`,
      [workspaceId, productId, factSetId],
    );
    if (!fsRes.rowCount || !fsRes.rows[0]) return null;

    const factsRes = await db.query<unknown>(
      `SELECT ${FACT_COLS} FROM product_facts
       WHERE workspace_id = $1 AND product_id = $2 AND fact_set_id = $3
       ORDER BY created_at ASC, id ASC`,
      [workspaceId, productId, factSetId],
    );

    return {
      factSet: mapProductFactSetRow(fsRes.rows[0]),
      facts: factsRes.rows.map(mapProductFactRow),
    };
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to query fact set by id');
  }
}

export async function queryListFactSets(
  db: Database,
  params: ListFactSetsPersistenceParams,
): Promise<ListFactSetsPersistenceResult> {
  try {
    const fetchLimit = params.limit + 1;
    const res = await db.query<unknown>(
      `SELECT ${FACT_SET_COLS} FROM product_fact_sets
       WHERE workspace_id = $1 AND product_id = $2
         AND (($3::int IS NULL) OR (revision_number < $3 OR (revision_number = $3 AND id < $4)))
       ORDER BY revision_number DESC, id DESC
       LIMIT $5`,
      [
        params.workspaceId,
        params.productId,
        params.cursor?.revisionNumber ?? null,
        params.cursor?.id ?? null,
        fetchLimit,
      ],
    );

    const hasMore = res.rows.length > params.limit;
    const rows = hasMore ? res.rows.slice(0, params.limit) : res.rows;
    const items = rows.map(mapProductFactSetRow);

    let nextCursor = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!;
      nextCursor = { revisionNumber: last.revisionNumber, id: last.id };
    }

    return { items, nextCursor };
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to list fact sets');
  }
}

export async function queryAffiliateDestinationById(
  db: Database,
  workspaceId: string,
  productId: ProductId,
  destinationId: AffiliateDestinationId,
): Promise<AffiliateDestinationSnapshot | null> {
  try {
    const res = await db.query<unknown>(
      `SELECT ${AFFILIATE_COLS} FROM affiliate_destinations
       WHERE workspace_id = $1 AND product_id = $2 AND id = $3`,
      [workspaceId, productId, destinationId],
    );
    return res.rowCount && res.rows[0] ? mapAffiliateDestinationRow(res.rows[0]) : null;
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to query affiliate destination by id');
  }
}

export async function queryListAffiliateDestinations(
  db: Database,
  params: ListAffiliateDestinationsPersistenceParams,
): Promise<ListAffiliateDestinationsPersistenceResult> {
  try {
    const fetchLimit = params.limit + 1;
    const res = await db.query<unknown>(
      `SELECT ${AFFILIATE_COLS} FROM affiliate_destinations
       WHERE workspace_id = $1 AND product_id = $2
         AND ($3::text IS NULL OR status = $3)
         AND (($4::timestamptz IS NULL) OR (updated_at < $4 OR (updated_at = $4 AND id < $5)))
       ORDER BY updated_at DESC, id DESC
       LIMIT $6`,
      [
        params.workspaceId,
        params.productId,
        params.status ?? null,
        params.cursor?.updatedAt ?? null,
        params.cursor?.id ?? null,
        fetchLimit,
      ],
    );

    const hasMore = res.rows.length > params.limit;
    const rows = hasMore ? res.rows.slice(0, params.limit) : res.rows;
    const items = rows.map(mapAffiliateDestinationRow);

    let nextCursor = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!;
      nextCursor = { updatedAt: last.updatedAt, id: last.id };
    }

    return { items, nextCursor };
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to list affiliate destinations');
  }
}
