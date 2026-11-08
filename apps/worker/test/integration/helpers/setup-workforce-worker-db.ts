import { generateUuidV7 } from '@affiliate-content-os/application';
import { computeCanonicalContextHash } from '@affiliate-content-os/domain';
import {
  setupIsolatedTestDatabase,
  type TestDatabaseContext,
} from '@affiliate-content-os/infrastructure/testing';
import {
  createDatabase,
  type DatabasePool,
  type Database,
} from '@affiliate-content-os/infrastructure/database';

export interface WorkforceWorkerSeedContext {
  readonly context: TestDatabaseContext;
  readonly database: Database;
  readonly pool: DatabasePool;
  readonly wsId: string;
  readonly userId: string;
  readonly prodId: string;
  readonly factSetId: string;
  readonly factId: string;
  readonly analysisId: string;
}

export const WORKER_FIXTURE_IDS = {
  wsId: '018f6c5b-21a4-789a-8def-500000000001',
  userId: '018f6c5b-21a4-789a-8def-500000000002',
  prodId: '018f6c5b-21a4-789a-8def-500000000003',
  factSetId: '018f6c5b-21a4-789a-8def-500000000004',
  factId: '018f6c5b-21a4-789a-8def-500000000005',
  analysisId: '018f6c5b-21a4-789a-8def-500000000006',
  opId: '018f6c5b-21a4-789a-8def-500000000007',
  runId: '018f6c5b-21a4-789a-8def-500000000008',
};

export async function setupWorkforceWorkerDatabase(): Promise<WorkforceWorkerSeedContext> {
  const context = await setupIsolatedTestDatabase();
  const database = createDatabase({
    databaseUrl: context.dbUrl,
    poolMax: 5,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 10000,
    statementTimeoutMs: 15000,
    sslMode: 'disable',
  });
  const pool = database.pool!;
  const { wsId, userId, prodId, factSetId, factId, analysisId, opId, runId } = WORKER_FIXTURE_IDS;

  await pool.query(
    `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
     VALUES ($1, 'google', 'sub-w', 'w@example.com', 'Worker User', 'active', NOW(), NOW(), 1)`,
    [userId],
  );

  await pool.query(
    `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
     VALUES ($1, 'Worker WS', 'worker-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
    [wsId],
  );

  await pool.query(
    `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at, version)
     VALUES ('018f6c5b-21a4-789a-8def-500000000010', $1, $2, 'owner', 'active', NOW(), NOW(), NOW(), 1)`,
    [wsId, userId],
  );

  await pool.query(
    `INSERT INTO workspace_ai_policies (
       workspace_id, ai_enabled, rate_limit_per_minute, minute_request_count,
       monthly_budget_microunits, current_spend_microunits, reserved_spend_microunits, updated_at
     ) VALUES ($1, true, 60, 0, 1000000000, 0, 0, NOW())`,
    [wsId],
  );

  await pool.query(
    `INSERT INTO products (
       id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
       category, description, status, current_fact_set_id, created_at, updated_at, version
     ) VALUES ($1, $2, 'Worker Product', 'Merchant', 'https://example.com/wp', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
    [prodId, wsId, Buffer.alloc(32, 1)],
  );

  await pool.query(
    `INSERT INTO product_fact_sets (
       id, workspace_id, product_id, revision_number, status, created_by_user_id,
       confirmed_by_user_id, confirmed_at, created_at, updated_at, version
     ) VALUES ($1, $2, $3, 1, 'proposed', $4, null, null, NOW(), NOW(), 1)`,
    [factSetId, wsId, prodId, userId],
  );

  await pool.query(
    `INSERT INTO product_facts (
       id, workspace_id, product_id, fact_set_id, fact_key, value_text,
       source_type, source_url, source_excerpt, confidence, claim_usage, created_at
     ) VALUES ($1, $2, $3, $4, 'lumbar_support', 'Dynamic posture lumbar support', 'merchant_page', null, null, 'confirmed', 'allowed', NOW())`,
    [factId, wsId, prodId, factSetId],
  );

  await pool.query(
    `UPDATE product_fact_sets
     SET status = 'confirmed', confirmed_by_user_id = $1, confirmed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [userId, factSetId],
  );

  await pool.query(`UPDATE products SET current_fact_set_id = $1 WHERE id = $2`, [
    factSetId,
    prodId,
  ]);

  await pool.query(
    `INSERT INTO operations (
       id, workspace_id, operation_type, resource_type, resource_id,
       status, result_location, started_at, completed_at, requested_by_user_id, created_at, updated_at, version
     ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'succeeded', '/res', NOW(), NOW(), $4, NOW(), NOW(), 1)`,
    [opId, wsId, prodId, userId],
  );

  await pool.query(
    `INSERT INTO ai_runs (
       id, workspace_id, operation_id, purpose, provider, model,
       prompt_template, prompt_version, input_schema_version, output_schema_version,
       input_hash, output_hash, status, requested_by_user_id, started_at, completed_at, created_at, updated_at, version
     ) VALUES ($1, $2, $3, 'product_analysis', 'google', 'gemini-3.8-flash', 'tmpl', '1.0', 1, 1, $4, $5, 'succeeded', $6, NOW(), NOW(), NOW(), NOW(), 1)`,
    [runId, wsId, opId, Buffer.alloc(32, 2), Buffer.alloc(32, 3), userId],
  );

  await pool.query(
    `INSERT INTO analyses (
       id, workspace_id, product_id, analysis_type, revision_number,
       fact_set_id, ai_run_id, content_json, schema_version, status,
       reviewed_by_user_id, reviewed_at, review_reason, created_by_user_id, created_at, updated_at, version
     ) VALUES ($1, $2, $3, 'product', 1, $4, $5, '{}', 1, 'accepted', $6, NOW(), 'Approved', $6, NOW(), NOW(), 1)`,
    [analysisId, wsId, prodId, factSetId, runId, userId],
  );

  return { context, database, pool, wsId, userId, prodId, factSetId, factId, analysisId };
}

export async function kickoffWorkerTestOrder(
  dbContext: WorkforceWorkerSeedContext,
  woId = generateUuidV7(),
): Promise<string> {
  const cpId = generateUuidV7();
  const contextHash = computeCanonicalContextHash({
    workspaceId: dbContext.wsId,
    productId: dbContext.prodId,
    productVersion: 1,
    factSetId: dbContext.factSetId,
    factSetVersion: 1,
    analyses: [{ analysisId: dbContext.analysisId, version: 1 }],
    schemaVersion: 1,
  });

  await dbContext.pool.query(
    `INSERT INTO context_packages (
       id, workspace_id, product_id, fact_set_id, context_schema_version, context_hash, created_by_user_id, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())`,
    [cpId, dbContext.wsId, dbContext.prodId, dbContext.factSetId, contextHash, dbContext.userId],
  );
  await dbContext.pool.query(
    `INSERT INTO context_package_analyses (workspace_id, context_package_id, analysis_id, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [dbContext.wsId, cpId, dbContext.analysisId],
  );
  await dbContext.pool.query(
    `INSERT INTO work_orders (
       id, workspace_id, product_id, context_package_id, mission_type, directive_text,
       graph_template, graph_version, status, created_by_user_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'short_video_series', 'Test mission', 'creative_office_v1', 1, 'in_progress', $5, NOW(), NOW())`,
    [woId, dbContext.wsId, dbContext.prodId, cpId, dbContext.userId],
  );
  const wiId = generateUuidV7();
  await dbContext.pool.query(
    `INSERT INTO work_items (
       id, workspace_id, work_order_id, role_definition_id, task_key, expected_artifact_type,
       status, created_at, updated_at
     ) VALUES ($1, $2, $3, '018f0000-0000-7000-8000-000000000002', 'product_strategy', 'product_campaign_plan', 'queued', NOW(), NOW())`,
    [wiId, dbContext.wsId, woId],
  );
  await dbContext.pool.query(
    `INSERT INTO agent_assignments (
       id, workspace_id, work_order_id, role_definition_id, work_item_id, office_state, created_at, updated_at
     ) VALUES ($1, $2, $3, '018f0000-0000-7000-8000-000000000002', $4, 'preparing', NOW(), NOW())`,
    [generateUuidV7(), dbContext.wsId, woId, wiId],
  );
  const opId = generateUuidV7();
  await dbContext.pool.query(
    `INSERT INTO operations (
       id, workspace_id, operation_type, resource_type, resource_id,
       status, requested_by_user_id, work_order_id, work_item_id, created_at, updated_at
     ) VALUES ($1, $2, 'product_strategy', 'product', $3, 'queued', $4, $5, $6, NOW(), NOW())`,
    [opId, dbContext.wsId, dbContext.prodId, dbContext.userId, woId, wiId],
  );
  const runId = generateUuidV7();
  await dbContext.pool.query(
    `INSERT INTO ai_runs (
       id, workspace_id, operation_id, requested_by_user_id, purpose,
       provider, model, prompt_template, prompt_version, input_schema_version, output_schema_version,
       input_hash, status, work_order_id, work_item_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'product_strategy', 'google', 'gemini-3.8-flash', 'product_strategy_v1', '1.0.0', 1, 1, $5, 'queued', $6, $7, NOW(), NOW())`,
    [runId, dbContext.wsId, opId, dbContext.userId, contextHash, woId, wiId],
  );
  const jobId = generateUuidV7();
  const payload = {
    workspaceId: dbContext.wsId,
    productId: dbContext.prodId,
    workOrderId: woId,
    workItemId: wiId,
    taskKey: 'product_strategy',
    roleKey: 'product_strategist',
    operationId: opId,
    aiRunId: runId,
    contextPackageId: cpId,
    actorUserId: dbContext.userId,
    reservedMicrounits: 50000,
  };
  const dedupKey = `workforce:${woId}:product_strategy:${jobId}`;
  await dbContext.pool.query(
    `INSERT INTO job_executions (
       id, workspace_id, job_type, deduplication_key, operation_id, ai_run_id, status,
       attempt, max_attempts, repair_attempt, max_repair_attempts,
       next_attempt_at, reserved_spend_microunits, payload_json,
       work_order_id, work_item_id, created_at, updated_at, version
     ) VALUES ($1, $2, 'workforce_planning', $3, $4, $5, 'queued', 0, 3, 0, 1, NOW(), 50000, $6::jsonb, $7, $8, NOW(), NOW(), 1)`,
    [jobId, dbContext.wsId, dedupKey, opId, runId, JSON.stringify(payload), woId, wiId],
  );
  await dbContext.pool.query(
    `UPDATE workspace_ai_policies SET reserved_spend_microunits = reserved_spend_microunits + 50000 WHERE workspace_id = $1`,
    [dbContext.wsId],
  );
  return woId;
}
