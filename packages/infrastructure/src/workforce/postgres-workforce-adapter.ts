import type pg from 'pg';
import type {
  ContentArtifactDetailDTO,
  ContentArtifactSummaryDTO,
  DecodedWorkOrderCursor,
  KickoffTransactionResult,
  KickoffWorkOrderAtomicParams,
  RetryWorkOrderPlanningAtomicParams,
  RetryWorkOrderPlanningResult,
  WorkforcePersistencePort,
  WorkOrderActivityDTO,
  WorkOrderDetailDTO,
  WorkOrderSummaryDTO,
} from '@affiliate-content-os/application';
import type {
  ProductId,
  WorkItemSnapshot,
  WorkOrderId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import { executeKickoffWorkOrderTransaction } from './kickoff-work-order-transaction.js';
import { executeRetryWorkOrderTransaction } from './retry-work-order-transaction.js';
import { queryWorkOrderDetail } from './workforce-detail-query.js';
import {
  queryArtifactById,
  queryWorkOrderActivities,
  queryWorkOrderArtifacts,
} from './workforce-artifact-queries.js';
import type { KickoffTestHooks } from './workforce-types.js';
import { mapWorkItemRowToSnapshot, mapWorkOrderRowToSummaryDTO } from './workforce-mappers.js';

export class PostgresWorkforceAdapter implements WorkforcePersistencePort {
  constructor(private readonly pool: pg.Pool) {}

  public async kickoffWorkOrderAtomic(
    params: KickoffWorkOrderAtomicParams,
    testHooks?: KickoffTestHooks,
  ): Promise<KickoffTransactionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await executeKickoffWorkOrderTransaction(client, params, testHooks);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async retryWorkOrderPlanningAtomic(
    params: RetryWorkOrderPlanningAtomicParams,
  ): Promise<RetryWorkOrderPlanningResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await executeRetryWorkOrderTransaction(client, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async getWorkOrderById(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<WorkOrderDetailDTO | null> {
    return queryWorkOrderDetail(this.pool, workspaceId, workOrderId);
  }

  public async listWorkOrders(
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
        res = await this.pool.query(
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
        res = await this.pool.query(
          `SELECT * FROM work_orders
           WHERE workspace_id = $1 AND product_id = $2
           ORDER BY updated_at DESC, id DESC
           LIMIT $3`,
          [workspaceId, options.productId, options.limit],
        );
      }
    } else {
      if (options.cursor) {
        res = await this.pool.query(
          `SELECT * FROM work_orders
           WHERE workspace_id = $1
             AND (updated_at < $2 OR (updated_at = $2 AND id < $3))
           ORDER BY updated_at DESC, id DESC
           LIMIT $4`,
          [workspaceId, options.cursor.updatedAt, options.cursor.id, options.limit],
        );
      } else {
        res = await this.pool.query(
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

  public async findReadyWorkItems(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly WorkItemSnapshot[]> {
    const res = await this.pool.query(
      `SELECT * FROM work_items
       WHERE workspace_id = $1 AND work_order_id = $2 AND status = 'ready'
       ORDER BY created_at ASC, id ASC`,
      [workspaceId, workOrderId],
    );

    return Object.freeze(res.rows.map(mapWorkItemRowToSnapshot));
  }

  public async listWorkOrderArtifacts(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly ContentArtifactSummaryDTO[]> {
    return queryWorkOrderArtifacts(this.pool, workspaceId, workOrderId);
  }

  public async getArtifactById(
    workspaceId: WorkspaceId,
    artifactId: string,
  ): Promise<ContentArtifactDetailDTO | null> {
    return queryArtifactById(this.pool, workspaceId, artifactId);
  }

  public async listWorkOrderActivities(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly WorkOrderActivityDTO[]> {
    return queryWorkOrderActivities(this.pool, workspaceId, workOrderId);
  }
}
