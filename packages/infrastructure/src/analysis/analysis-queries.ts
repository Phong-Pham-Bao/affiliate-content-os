import type pg from 'pg';
import {
  type AnalysisId,
  type AnalysisSnapshot,
  type OperationId,
  type OperationSnapshot,
  type AIRunId,
  type AIRunSnapshot,
  type WorkspaceAIPolicySnapshot,
  type WorkspaceId,
  type UserId,
  type AuditEventId,
} from '@affiliate-content-os/domain';
import {
  decodeAnalysisCursor,
  encodeAnalysisCursor,
  ReviewConflictError,
  AnalysisNotFoundError,
  StaleVersionConflictError,
  type ListAnalysesFilter,
  type PaginatedResult,
  type ReviewAnalysisAtomicParams,
} from '@affiliate-content-os/application';
import {
  mapAIRunRow,
  mapAnalysisRow,
  mapOperationRow,
  mapWorkspaceAIPolicyRow,
} from './analysis-mappers.js';
import { DatabaseError } from '../database/errors.js';

export async function queryAnalysisById(
  pool: pg.Pool,
  workspaceId: WorkspaceId,
  analysisId: AnalysisId,
): Promise<AnalysisSnapshot | null> {
  const res = await pool.query(`SELECT * FROM analyses WHERE workspace_id = $1 AND id = $2`, [
    workspaceId,
    analysisId,
  ]);
  if (res.rows.length === 0) return null;
  return mapAnalysisRow(res.rows[0]);
}

export async function queryListAnalyses(
  pool: pg.Pool,
  workspaceId: WorkspaceId,
  filter: ListAnalysesFilter,
): Promise<PaginatedResult<AnalysisSnapshot>> {
  const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
  const conditions: string[] = ['workspace_id = $1', 'product_id = $2'];
  const values: unknown[] = [workspaceId, filter.productId];
  let paramIdx = 3;

  if (filter.analysisType) {
    conditions.push(`analysis_type = $${paramIdx++}`);
    values.push(filter.analysisType);
  }
  if (filter.status) {
    conditions.push(`status = $${paramIdx++}`);
    values.push(filter.status);
  }

  if (filter.cursor) {
    const decoded = decodeAnalysisCursor(filter.cursor);
    conditions.push(
      `(updated_at < $${paramIdx} OR (updated_at = $${paramIdx} AND id < $${paramIdx + 1}))`,
    );
    values.push(decoded.updatedAt, decoded.id);
    paramIdx += 2;
  }

  values.push(limit + 1);
  const res = await pool.query(
    `SELECT * FROM analyses
     WHERE ${conditions.join(' AND ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT $${paramIdx}`,
    values,
  );

  const hasMore = res.rows.length > limit;
  const rawItems = hasMore ? res.rows.slice(0, limit) : res.rows;
  const items = rawItems.map(mapAnalysisRow);
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem ? encodeAnalysisCursor(lastItem.updatedAt, lastItem.id) : null;

  return { items, nextCursor };
}

export async function executeReviewAnalysisTransaction(
  client: pg.PoolClient,
  params: ReviewAnalysisAtomicParams,
): Promise<AnalysisSnapshot> {
  // 1. Lock analysis row FOR UPDATE
  const checkRes = await client.query(
    `SELECT * FROM analyses WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [params.workspaceId, params.analysisId],
  );

  if (checkRes.rows.length === 0) {
    throw new AnalysisNotFoundError(params.analysisId);
  }

  const existingRow = checkRes.rows[0];

  // 2. Same decision is idempotent even when caller repeats old expectedVersion
  if (existingRow.status === params.decision) {
    return mapAnalysisRow(existingRow);
  }

  // 3. Conflicting decision when analysis is already reviewed remains a 409 conflict
  if (existingRow.status !== 'generated') {
    throw new ReviewConflictError(
      `Cannot change review decision from "${existingRow.status}" to "${params.decision}"`,
    );
  }

  // 4. Check optimistic concurrency version on unreviewed ('generated') analysis
  if (Number(existingRow.version) !== params.expectedVersion) {
    throw new ReviewConflictError(
      'Analysis version conflict: expected version does not match current version',
    );
  }

  // 5. Update analysis status
  const updateRes = await client.query(
    `UPDATE analyses
     SET status = $1,
         reviewed_by_user_id = $2,
         reviewed_at = $3,
         review_reason = $4,
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $5 AND id = $6 AND version = $7
     RETURNING *`,
    [
      params.decision,
      params.reviewedByUserId,
      params.reviewedAt,
      params.reviewReason,
      params.workspaceId,
      params.analysisId,
      params.expectedVersion,
    ],
  );

  if (updateRes.rows.length === 0) {
    throw new ReviewConflictError('Failed to update analysis: concurrent update conflict');
  }

  // 6. Append audit event atomically in same transaction on first state change
  const auditRes = await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, reason_code, changes_json, occurred_at, created_at
     )
     VALUES ($1, $2, 'user', $3, $4, $5, $6, 'succeeded', null, $7, NOW(), NOW())`,
    [
      params.auditEvent.id,
      params.auditEvent.workspaceId,
      params.auditEvent.actorUserId,
      params.auditEvent.action,
      params.auditEvent.resourceType,
      params.auditEvent.resourceId,
      JSON.stringify(params.auditEvent.changesJson),
    ],
  );
  if (auditRes.rowCount !== 1) {
    throw new DatabaseError(`Failed to insert audit event for analysis ${params.analysisId}`);
  }

  return mapAnalysisRow(updateRes.rows[0]);
}

export async function queryOperationById(
  pool: pg.Pool,
  workspaceId: WorkspaceId,
  operationId: OperationId,
): Promise<OperationSnapshot | null> {
  const res = await pool.query(`SELECT * FROM operations WHERE workspace_id = $1 AND id = $2`, [
    workspaceId,
    operationId,
  ]);
  if (res.rows.length === 0) return null;
  return mapOperationRow(res.rows[0]);
}

export async function queryAIRunById(
  pool: pg.Pool,
  workspaceId: WorkspaceId,
  aiRunId: AIRunId,
): Promise<AIRunSnapshot | null> {
  const res = await pool.query(`SELECT * FROM ai_runs WHERE workspace_id = $1 AND id = $2`, [
    workspaceId,
    aiRunId,
  ]);
  if (res.rows.length === 0) return null;
  return mapAIRunRow(res.rows[0]);
}

export async function queryWorkspaceAIPolicy(
  pool: pg.Pool,
  workspaceId: WorkspaceId,
): Promise<WorkspaceAIPolicySnapshot> {
  const res = await pool.query(`SELECT * FROM workspace_ai_policies WHERE workspace_id = $1`, [
    workspaceId,
  ]);
  if (res.rows.length === 0) {
    throw new DatabaseError(`Workspace AI policy not found for ${workspaceId}`);
  }
  return mapWorkspaceAIPolicyRow(res.rows[0]);
}

export async function queryUpsertWorkspaceAIPolicy(
  client: pg.PoolClient,
  params: {
    readonly workspaceId: WorkspaceId;
    readonly aiEnabled: boolean;
    readonly monthlyBudgetMicrounits: number;
    readonly rateLimitPerMinute: number;
    readonly expectedVersion: number;
    readonly actorUserId: UserId;
    readonly auditEventId: AuditEventId;
  },
): Promise<WorkspaceAIPolicySnapshot> {
  const current = await client.query(
    `SELECT version FROM workspace_ai_policies WHERE workspace_id = $1 FOR UPDATE`,
    [params.workspaceId],
  );
  if (current.rows.length === 0) {
    throw new DatabaseError(`Workspace AI policy not found for ${params.workspaceId}`);
  }
  if (Number(current.rows[0].version) !== params.expectedVersion) {
    throw new StaleVersionConflictError(params.expectedVersion, Number(current.rows[0].version));
  }

  const res = await client.query(
    `UPDATE workspace_ai_policies
     SET ai_enabled = $2,
         monthly_budget_microunits = $3,
         rate_limit_per_minute = $4,
         updated_at = NOW(),
         version = version + 1
     WHERE workspace_id = $1 AND version = $5
     RETURNING *`,
    [
      params.workspaceId,
      params.aiEnabled,
      params.monthlyBudgetMicrounits,
      params.rateLimitPerMinute,
      params.expectedVersion,
    ],
  );
  if (res.rowCount !== 1) {
    throw new StaleVersionConflictError(params.expectedVersion);
  }
  await client.query(
    `INSERT INTO audit_events (
       id, workspace_id, actor_type, actor_user_id, action, resource_type,
       resource_id, result, reason_code, changes_json, occurred_at, created_at
     ) VALUES ($1, $2, 'user', $3, 'workspace.ai_policy.updated', 'workspace', $2,
       'succeeded', NULL, $4, NOW(), NOW())`,
    [
      params.auditEventId,
      params.workspaceId,
      params.actorUserId,
      JSON.stringify({
        ai_enabled: params.aiEnabled,
        monthly_budget_microunits: params.monthlyBudgetMicrounits,
        rate_limit_per_minute: params.rateLimitPerMinute,
      }),
    ],
  );
  return mapWorkspaceAIPolicyRow(res.rows[0]);
}
