import type pg from 'pg';
import type {
  AIRunId,
  AIRunSnapshot,
  AnalysisId,
  AnalysisSnapshot,
  OperationId,
  OperationSnapshot,
  WorkspaceAIPolicySnapshot,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type {
  AnalysisPersistencePort,
  AIRunPersistencePort,
  EnqueueAnalysisAtomicParams,
  EnqueueAnalysisTransactionPort,
  EnqueueAnalysisTransactionResult,
  ListAnalysesFilter,
  OperationPersistencePort,
  PaginatedResult,
  PersistExecutionResultAtomicParams,
  PersistExecutionResultTransactionPort,
  PersistExecutionTransactionResult,
  ReviewAnalysisAtomicParams,
  WorkspaceAIPolicyPort,
} from '@affiliate-content-os/application';
import { executeEnqueueAnalysisTransaction } from './enqueue-analysis-transaction.js';
import { executePersistExecutionTransaction } from './persist-execution-transaction.js';
import {
  executeReviewAnalysisTransaction,
  queryAIRunById,
  queryAnalysisById,
  queryListAnalyses,
  queryOperationById,
  queryUpsertWorkspaceAIPolicy,
  queryWorkspaceAIPolicy,
} from './analysis-queries.js';

export class PostgresAnalysisAdapter
  implements
    AnalysisPersistencePort,
    OperationPersistencePort,
    AIRunPersistencePort,
    WorkspaceAIPolicyPort,
    EnqueueAnalysisTransactionPort,
    PersistExecutionResultTransactionPort
{
  constructor(private readonly pool: pg.Pool) {}

  // AnalysisPersistencePort
  public async getAnalysisById(
    workspaceId: WorkspaceId,
    analysisId: AnalysisId,
  ): Promise<AnalysisSnapshot | null> {
    return queryAnalysisById(this.pool, workspaceId, analysisId);
  }

  public async listAnalyses(
    workspaceId: WorkspaceId,
    filter: ListAnalysesFilter,
  ): Promise<PaginatedResult<AnalysisSnapshot>> {
    return queryListAnalyses(this.pool, workspaceId, filter);
  }

  public async reviewAnalysisAtomic(params: ReviewAnalysisAtomicParams): Promise<AnalysisSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await executeReviewAnalysisTransaction(client, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // OperationPersistencePort
  public async getOperationById(
    workspaceId: WorkspaceId,
    operationId: OperationId,
  ): Promise<OperationSnapshot | null> {
    return queryOperationById(this.pool, workspaceId, operationId);
  }

  // AIRunPersistencePort
  public async getAIRunById(
    workspaceId: WorkspaceId,
    aiRunId: AIRunId,
  ): Promise<AIRunSnapshot | null> {
    return queryAIRunById(this.pool, workspaceId, aiRunId);
  }

  // WorkspaceAIPolicyPort
  public async getPolicy(workspaceId: WorkspaceId): Promise<WorkspaceAIPolicySnapshot> {
    return queryWorkspaceAIPolicy(this.pool, workspaceId);
  }

  public async updatePolicy(params: {
    readonly workspaceId: WorkspaceId;
    readonly aiEnabled: boolean;
    readonly monthlyBudgetMicrounits: number;
    readonly rateLimitPerMinute: number;
    readonly expectedVersion: number;
    readonly actorUserId: import('@affiliate-content-os/domain').UserId;
    readonly auditEventId: import('@affiliate-content-os/domain').AuditEventId;
  }): Promise<WorkspaceAIPolicySnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await queryUpsertWorkspaceAIPolicy(client, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // EnqueueAnalysisTransactionPort
  public async enqueueAnalysisAtomic(
    params: EnqueueAnalysisAtomicParams,
  ): Promise<EnqueueAnalysisTransactionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await executeEnqueueAnalysisTransaction(client, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // PersistExecutionResultTransactionPort
  public async persistExecutionResultAtomic(
    params: PersistExecutionResultAtomicParams,
  ): Promise<PersistExecutionTransactionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await executePersistExecutionTransaction(client, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
