import type pg from 'pg';
import type {
  DecodedWorkOrderCursor,
  WorkOrderSummaryDTO,
} from '@affiliate-content-os/application';
import type { ProductId, WorkspaceId } from '@affiliate-content-os/domain';
import { mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';

export async function queryWorkOrdersList(
  pool: pg.Pool,
  workspaceId: WorkspaceId,
  options: {
    readonly cursor?: DecodedWorkOrderCursor | undefined;
    readonly limit: number;
    readonly productId?: ProductId | undefined;
  },
): Promise<readonly WorkOrderSummaryDTO[]> {
  let res: pg.QueryResult;
  if (options.productId) {
    if (options.cursor) {
      res = await pool.query(
        `SELECT * FROM work_orders
         WHERE workspace_id = $1 AND product_id = $2
           AND (updated_at < $3 OR (updated_at = $3 AND id < $4))
         ORDER BY updated_at DESC, id DESC
         LIMIT $5`,
        [
          workspaceId,
          options.productId,
          options.cursor.updatedAt,
          options.cursor.id,
          options.limit,
        ],
      );
    } else {
      res = await pool.query(
        `SELECT * FROM work_orders
         WHERE workspace_id = $1 AND product_id = $2
         ORDER BY updated_at DESC, id DESC
         LIMIT $3`,
        [workspaceId, options.productId, options.limit],
      );
    }
  } else {
    if (options.cursor) {
      res = await pool.query(
        `SELECT * FROM work_orders
         WHERE workspace_id = $1
           AND (updated_at < $2 OR (updated_at = $2 AND id < $3))
         ORDER BY updated_at DESC, id DESC
         LIMIT $4`,
        [workspaceId, options.cursor.updatedAt, options.cursor.id, options.limit],
      );
    } else {
      res = await pool.query(
        `SELECT * FROM work_orders
         WHERE workspace_id = $1
         ORDER BY updated_at DESC, id DESC
         LIMIT $2`,
        [workspaceId, options.limit],
      );
    }
  }

  return Object.freeze(res.rows.map(mapWorkOrderRowToSummaryDTO));
}
