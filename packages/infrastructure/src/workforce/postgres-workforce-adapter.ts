import type pg from 'pg';
import type {
  DecodedWorkOrderCursor,
  KickoffTransactionResult,
  KickoffWorkOrderAtomicParams,
  WorkforcePersistencePort,
  WorkOrderDetailDTO,
  WorkOrderSummaryDTO,
} from '@affiliate-content-os/application';
import {
  parseAnalysisId,
  type WorkItemSnapshot,
  type WorkOrderId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import { executeKickoffWorkOrderTransaction } from './kickoff-work-order-transaction.js';
import type { KickoffTestHooks } from './workforce-types.js';
import {
  mapAgentAssignmentRowToSummaryDTO,
  mapContextPackageRowToSummaryDTO,
  mapWorkItemDependencyRowToSummaryDTO,
  mapWorkItemRowToSnapshot,
  mapWorkItemRowToSummaryDTO,
  mapWorkOrderRowToSummaryDTO,
} from './workforce-mappers.js';

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

  public async getWorkOrderById(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<WorkOrderDetailDTO | null> {
    const orderRes = await this.pool.query(
      `SELECT * FROM work_orders WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, workOrderId],
    );

    if (orderRes.rows.length === 0) {
      return null;
    }

    const orderRow = orderRes.rows[0];
    const workOrder = mapWorkOrderRowToSummaryDTO(orderRow);

    // Context package
    const pkgRes = await this.pool.query(
      `SELECT * FROM context_packages WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, orderRow.context_package_id],
    );
    const pkgAnalysesRes = await this.pool.query(
      `SELECT analysis_id FROM context_package_analyses
       WHERE workspace_id = $1 AND context_package_id = $2
       ORDER BY analysis_id ASC`,
      [workspaceId, orderRow.context_package_id],
    );
    const analysisIds = pkgAnalysesRes.rows.map((r: { readonly analysis_id: string }) =>
      parseAnalysisId(r.analysis_id),
    );
    const contextPackage = mapContextPackageRowToSummaryDTO(pkgRes.rows[0], analysisIds);

    // Work items with role_key
    const itemsRes = await this.pool.query(
      `SELECT wi.*, ard.role_key
       FROM work_items wi
       JOIN agent_role_definitions ard ON ard.id = wi.role_definition_id
       WHERE wi.workspace_id = $1 AND wi.work_order_id = $2
       ORDER BY wi.created_at ASC, wi.id ASC`,
      [workspaceId, workOrderId],
    );
    const workItems = itemsRes.rows.map(mapWorkItemRowToSummaryDTO);

    // Assignments with role_key
    const assignRes = await this.pool.query(
      `SELECT aa.*, ard.role_key
       FROM agent_assignments aa
       JOIN agent_role_definitions ard ON ard.id = aa.role_definition_id
       WHERE aa.workspace_id = $1 AND aa.work_order_id = $2
       ORDER BY aa.created_at ASC, aa.id ASC`,
      [workspaceId, workOrderId],
    );
    const assignments = assignRes.rows.map(mapAgentAssignmentRowToSummaryDTO);

    // Dependencies
    const depRes = await this.pool.query(
      `SELECT * FROM work_item_dependencies
       WHERE workspace_id = $1 AND work_order_id = $2
       ORDER BY created_at ASC, id ASC`,
      [workspaceId, workOrderId],
    );
    const dependencies = depRes.rows.map(mapWorkItemDependencyRowToSummaryDTO);

    return Object.freeze({
      workOrder: Object.freeze(workOrder),
      contextPackage: Object.freeze({
        ...contextPackage,
        analysisIds: Object.freeze([...contextPackage.analysisIds]),
      }),
      workItems: Object.freeze(workItems.map((item) => Object.freeze(item))),
      assignments: Object.freeze(assignments.map((a) => Object.freeze(a))),
      dependencies: Object.freeze(dependencies.map((d) => Object.freeze(d))),
    });
  }

  public async listWorkOrders(
    workspaceId: WorkspaceId,
    options: {
      readonly cursor?: DecodedWorkOrderCursor | undefined;
      readonly limit: number;
    },
  ): Promise<readonly WorkOrderSummaryDTO[]> {
    let res: pg.QueryResult;
    if (options.cursor) {
      res = await this.pool.query(
        `SELECT *
         FROM work_orders
         WHERE workspace_id = $1
           AND (updated_at < $2 OR (updated_at = $2 AND id < $3))
         ORDER BY updated_at DESC, id DESC
         LIMIT $4`,
        [workspaceId, options.cursor.updatedAt, options.cursor.id, options.limit],
      );
    } else {
      res = await this.pool.query(
        `SELECT *
         FROM work_orders
         WHERE workspace_id = $1
         ORDER BY updated_at DESC, id DESC
         LIMIT $2`,
        [workspaceId, options.limit],
      );
    }

    return Object.freeze(res.rows.map(mapWorkOrderRowToSummaryDTO));
  }

  public async findReadyWorkItems(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly WorkItemSnapshot[]> {
    const res = await this.pool.query(
      `SELECT *
       FROM work_items
       WHERE workspace_id = $1 AND work_order_id = $2 AND status = 'ready'
       ORDER BY created_at ASC, id ASC`,
      [workspaceId, workOrderId],
    );

    return Object.freeze(res.rows.map(mapWorkItemRowToSnapshot));
  }
}
