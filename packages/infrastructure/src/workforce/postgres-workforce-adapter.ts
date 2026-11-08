import type pg from 'pg';
import type {
  ArtifactChangeRequestDTO,
  ContentArtifactDetailDTO,
  ContentArtifactRevisionDTO,
  ContentArtifactSummaryDTO,
  CreateManualRevisionParams,
  DecodedWorkOrderCursor,
  KickoffTransactionResult,
  KickoffWorkOrderAtomicParams,
  RequestScriptChangesParams,
  RetryWorkOrderPlanningAtomicParams,
  RetryWorkOrderPlanningResult,
  ScriptGenerationUnitDTO,
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
import { queryWorkOrdersList } from './workforce-list-query.js';
import {
  queryArtifactById,
  queryWorkOrderActivities,
  queryWorkOrderArtifacts,
} from './workforce-artifact-queries.js';
import {
  getArtifactRevisionByNumberQuery,
  getArtifactRevisionsQuery,
  getChangeRequestByIdQuery,
  listScriptUnitsQuery,
} from './workforce-revision-queries.js';
import { createManualRevisionTransaction } from './workforce-manual-revision.js';
import { requestScriptChangesTransaction } from './workforce-request-changes.js';
import type { KickoffTestHooks } from './workforce-types.js';
import { mapWorkItemRowToSnapshot } from './workforce-mappers.js';

export class PostgresWorkforceAdapter implements WorkforcePersistencePort {
  constructor(private readonly pool: pg.Pool) {}

  private async withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await fn(client);
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async kickoffWorkOrderAtomic(
    params: KickoffWorkOrderAtomicParams,
    testHooks?: KickoffTestHooks,
  ): Promise<KickoffTransactionResult> {
    return this.withTransaction((client) =>
      executeKickoffWorkOrderTransaction(client, params, testHooks),
    );
  }

  public async retryWorkOrderPlanningAtomic(
    params: RetryWorkOrderPlanningAtomicParams,
  ): Promise<RetryWorkOrderPlanningResult> {
    return this.withTransaction((client) => executeRetryWorkOrderTransaction(client, params));
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
    return queryWorkOrdersList(this.pool, workspaceId, options);
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

  public async getArtifactRevisions(
    workspaceId: WorkspaceId,
    artifactId: string,
  ): Promise<readonly ContentArtifactRevisionDTO[]> {
    return this.withClient((client) => getArtifactRevisionsQuery(client, workspaceId, artifactId));
  }

  public async getArtifactRevisionByNumber(
    workspaceId: WorkspaceId,
    artifactId: string,
    revisionNumber: number,
  ): Promise<ContentArtifactDetailDTO | null> {
    return this.withClient((client) =>
      getArtifactRevisionByNumberQuery(client, workspaceId, artifactId, revisionNumber),
    );
  }

  public async getChangeRequestById(
    workspaceId: WorkspaceId,
    artifactId: string,
    changeRequestId: string,
  ): Promise<ArtifactChangeRequestDTO | null> {
    return this.withClient((client) =>
      getChangeRequestByIdQuery(client, workspaceId, artifactId, changeRequestId),
    );
  }

  public async createManualRevision(
    params: CreateManualRevisionParams,
  ): Promise<ContentArtifactDetailDTO> {
    return this.withTransaction((client) => createManualRevisionTransaction(client, params));
  }

  public async requestScriptChanges(
    params: RequestScriptChangesParams,
  ): Promise<ArtifactChangeRequestDTO> {
    return this.withTransaction((client) => requestScriptChangesTransaction(client, params));
  }

  public async listScriptUnits(
    workspaceId: WorkspaceId,
    workOrderId: string,
    changeRequestId?: string | null,
  ): Promise<readonly ScriptGenerationUnitDTO[]> {
    return this.withClient((client) =>
      listScriptUnitsQuery(client, workspaceId, workOrderId, changeRequestId),
    );
  }

  public async listWorkOrderActivities(
    workspaceId: WorkspaceId,
    workOrderId: WorkOrderId,
  ): Promise<readonly WorkOrderActivityDTO[]> {
    return queryWorkOrderActivities(this.pool, workspaceId, workOrderId);
  }
}
