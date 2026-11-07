import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseAIRunId,
  parseJobExecutionId,
  parseOperationId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { PostgresAnalysisAdapter } from '../../src/analysis/postgres-analysis-adapter.js';
import { IdempotencyKeyReusedError } from '@affiliate-content-os/application';

describe('enqueue-analysis-atomic.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresAnalysisAdapter;

  const wsId = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001');
  const userId = parseUserId('018f6c5b-21a4-789a-8def-000000000002');
  const prodId = parseProductId('018f6c5b-21a4-789a-8def-000000000003');
  const factSetId = parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000004');

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresAnalysisAdapter(pool);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-enq', 'enq@example.com', 'Enq User', 'active', NOW(), NOW(), 1)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Enq WS', 'enq-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId],
    );
    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Enq Prod', 'Merchant', 'https://example.com/enq', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prodId, wsId, Buffer.alloc(32, 1)],
    );
    await pool.query(
      `INSERT INTO product_fact_sets (
         id, workspace_id, product_id, revision_number, status, created_by_user_id,
         confirmed_by_user_id, confirmed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 1, 'confirmed', $4, $4, NOW(), NOW(), NOW(), 1)`,
      [factSetId, wsId, prodId, userId],
    );
    await pool.query(
      `INSERT INTO workspace_ai_policies (
         workspace_id, ai_enabled, monthly_budget_microunits, current_spend_microunits,
         reserved_spend_microunits, rate_limit_per_minute, budget_period_start,
         minute_window_start, minute_request_count, updated_at, version
       ) VALUES ($1, true, 100000000, 0, 0, 10, NOW(), NOW(), 0, NOW(), 1)`,
      [wsId],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('atomically creates operation, ai_run, job, outbox, idempotency, budget reservation, and audit event', async () => {
    const opId = parseOperationId('018f6c5b-21a4-789a-8def-000000000010');
    const aiRunId = parseAIRunId('018f6c5b-21a4-789a-8def-000000000020');
    const jobId = parseJobExecutionId('018f6c5b-21a4-789a-8def-000000000030');
    const outboxId = '018f6c5b-21a4-789a-8def-000000000040';
    const auditId = '018f6c5b-21a4-789a-8def-000000000050';

    const keyHash = Buffer.alloc(32, 5);
    const reqHash = Buffer.alloc(32, 6);

    const result = await adapter.enqueueAnalysisAtomic({
      operation: {
        id: opId,
        workspaceId: wsId,
        operationType: 'product_analysis',
        resourceType: 'product',
        resourceId: prodId,
        requestedByUserId: userId,
      },
      aiRun: {
        id: aiRunId,
        workspaceId: wsId,
        operationId: opId,
        purpose: 'product_analysis',
        provider: 'google',
        model: 'gemini-2.5-flash',
        promptTemplate: 'product_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        inputHash: reqHash,
        requestedByUserId: userId,
      },
      job: {
        id: jobId,
        workspaceId: wsId,
        operationId: opId,
        aiRunId: aiRunId,
        jobType: 'ai_analysis',
        deduplicationKey: `product:${prodId}:${factSetId}`,
        reservedSpendMicrounits: 50000,
        payloadJson: { opId },
      },
      outboxEvent: {
        id: outboxId,
        workspaceId: wsId,
        eventType: 'ai_analysis.enqueued',
        aggregateType: 'analysis',
        aggregateId: opId,
        payloadJson: { opId },
      },
      idempotency: {
        keyHash,
        requestHash: reqHash,
        principalId: userId,
        routeKey: 'POST /analyses',
        statusCode: 202,
        responseJson: { operationId: opId },
        resourceId: opId,
      },
      estimatedCostMicrounits: 50000,
      auditEvent: {
        id: auditId,
        workspaceId: wsId,
        actorUserId: userId,
        action: 'ai_analysis.enqueued',
        resourceType: 'operation',
        resourceId: opId,
        changesJson: { opId },
      },
    });

    expect(result.operationId).toBe(opId);

    // Verify all 6 tables have their rows
    const opRow = await pool.query('SELECT * FROM operations WHERE id = $1', [opId]);
    expect(opRow.rows).toHaveLength(1);

    const runRow = await pool.query('SELECT * FROM ai_runs WHERE id = $1', [aiRunId]);
    expect(runRow.rows).toHaveLength(1);

    const jobRow = await pool.query('SELECT * FROM job_executions WHERE id = $1', [jobId]);
    expect(jobRow.rows).toHaveLength(1);

    const outboxRow = await pool.query('SELECT * FROM outbox_events WHERE id = $1', [outboxId]);
    expect(outboxRow.rows).toHaveLength(1);

    const idempRow = await pool.query('SELECT * FROM idempotency_keys WHERE key_hash = $1', [
      keyHash,
    ]);
    expect(idempRow.rows).toHaveLength(1);

    const policyRow = await pool.query(
      'SELECT * FROM workspace_ai_policies WHERE workspace_id = $1',
      [wsId],
    );
    expect(policyRow.rows[0].reserved_spend_microunits).toBe('50000');

    // 2. Re-executing with identical key and request hash returns cached result without creating duplicate rows
    const cachedResult = await adapter.enqueueAnalysisAtomic({
      operation: {
        id: parseOperationId('018f6c5b-21a4-789a-8def-999999999999'),
        workspaceId: wsId,
        operationType: 'product_analysis',
        resourceType: 'product',
        resourceId: prodId,
        requestedByUserId: userId,
      },
      aiRun: {
        id: parseAIRunId('018f6c5b-21a4-789a-8def-888888888888'),
        workspaceId: wsId,
        operationId: opId,
        purpose: 'product_analysis',
        provider: 'google',
        model: 'gemini-2.5-flash',
        promptTemplate: 'product_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        inputHash: reqHash,
        requestedByUserId: userId,
      },
      job: {
        id: parseJobExecutionId('018f6c5b-21a4-789a-8def-777777777777'),
        workspaceId: wsId,
        operationId: opId,
        aiRunId: parseAIRunId('018f6c5b-21a4-789a-8def-888888888888'),
        jobType: 'ai_analysis',
        deduplicationKey: `product:${prodId}:${factSetId}`,
        reservedSpendMicrounits: 50000,
        payloadJson: { opId },
      },
      outboxEvent: {
        id: '018f6c5b-21a4-789a-8def-666666666666',
        workspaceId: wsId,
        eventType: 'ai_analysis.enqueued',
        aggregateType: 'analysis',
        aggregateId: opId,
        payloadJson: { opId },
      },
      idempotency: {
        keyHash,
        requestHash: reqHash,
        principalId: userId,
        routeKey: 'POST /analyses',
        statusCode: 202,
        responseJson: { operationId: opId },
        resourceId: opId,
      },
      estimatedCostMicrounits: 50000,
      auditEvent: {
        id: '018f6c5b-21a4-789a-8def-555555555555',
        workspaceId: wsId,
        actorUserId: userId,
        action: 'ai_analysis.enqueued',
        resourceType: 'operation',
        resourceId: opId,
        changesJson: { opId },
      },
    });

    expect(cachedResult.operationId).toBe(opId);
    expect(cachedResult.cached).toBe(true);

    // 3. Re-executing with same key hash but different request hash throws IdempotencyKeyReusedError
    const diffReqHash = Buffer.alloc(32, 9);
    await expect(
      adapter.enqueueAnalysisAtomic({
        operation: {
          id: opId,
          workspaceId: wsId,
          operationType: 'product_analysis',
          resourceType: 'product',
          resourceId: prodId,
          requestedByUserId: userId,
        },
        aiRun: {
          id: aiRunId,
          workspaceId: wsId,
          operationId: opId,
          purpose: 'product_analysis',
          provider: 'google',
          model: 'gemini-2.5-flash',
          promptTemplate: 'product_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
          inputHash: diffReqHash,
          requestedByUserId: userId,
        },
        job: {
          id: jobId,
          workspaceId: wsId,
          operationId: opId,
          aiRunId: aiRunId,
          jobType: 'ai_analysis',
          deduplicationKey: `product:${prodId}:${factSetId}`,
          reservedSpendMicrounits: 50000,
          payloadJson: { opId },
        },
        outboxEvent: {
          id: outboxId,
          workspaceId: wsId,
          eventType: 'ai_analysis.enqueued',
          aggregateType: 'analysis',
          aggregateId: opId,
          payloadJson: { opId },
        },
        idempotency: {
          keyHash,
          requestHash: diffReqHash,
          principalId: userId,
          routeKey: 'POST /analyses',
          statusCode: 202,
          responseJson: { operationId: opId },
          resourceId: opId,
        },
        estimatedCostMicrounits: 50000,
        auditEvent: {
          id: auditId,
          workspaceId: wsId,
          actorUserId: userId,
          action: 'ai_analysis.enqueued',
          resourceType: 'operation',
          resourceId: opId,
          changesJson: { opId },
        },
      }),
    ).rejects.toThrow(IdempotencyKeyReusedError);
  });

  it('concurrent identical requests serialize on advisory lock without unique violation', async () => {
    const concurrentKeyHash = Buffer.alloc(32, 50);
    const concurrentReqHash = Buffer.alloc(32, 51);
    const op1 = parseOperationId('018f6c5b-21a4-789a-8def-aaaaaaaaaaa1');
    const op2 = parseOperationId('018f6c5b-21a4-789a-8def-aaaaaaaaaaa2');

    const makeParams = (op: string, run: string, job: string, outbox: string, audit: string) => ({
      operation: {
        id: parseOperationId(op),
        workspaceId: wsId,
        operationType: 'product_analysis' as const,
        resourceType: 'product' as const,
        resourceId: prodId,
        requestedByUserId: userId,
      },
      aiRun: {
        id: parseAIRunId(run),
        workspaceId: wsId,
        operationId: parseOperationId(op),
        purpose: 'product_analysis' as const,
        provider: 'google',
        model: 'gemini-2.5-flash',
        promptTemplate: 'product_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        inputHash: concurrentReqHash,
        requestedByUserId: userId,
      },
      job: {
        id: parseJobExecutionId(job),
        workspaceId: wsId,
        operationId: parseOperationId(op),
        aiRunId: parseAIRunId(run),
        jobType: 'ai_analysis',
        deduplicationKey: `product:${prodId}:${job}`,
        reservedSpendMicrounits: 50000,
        payloadJson: { opId: op },
      },
      outboxEvent: {
        id: outbox,
        workspaceId: wsId,
        eventType: 'ai_analysis.enqueued',
        aggregateType: 'analysis',
        aggregateId: op,
        payloadJson: { opId: op },
      },
      idempotency: {
        keyHash: concurrentKeyHash,
        requestHash: concurrentReqHash,
        principalId: userId,
        routeKey: 'POST /analyses',
        statusCode: 202,
        responseJson: { operationId: op },
        resourceId: op,
      },
      estimatedCostMicrounits: 50000,
      auditEvent: {
        id: audit,
        workspaceId: wsId,
        actorUserId: userId,
        action: 'ai_analysis.enqueued',
        resourceType: 'operation',
        resourceId: op,
        changesJson: { opId: op },
      },
    });

    const [res1, res2] = await Promise.all([
      adapter.enqueueAnalysisAtomic(
        makeParams(
          op1,
          '018f6c5b-21a4-789a-8def-bbbbbbbbbbb1',
          '018f6c5b-21a4-789a-8def-ccccccccccc1',
          '018f6c5b-21a4-789a-8def-ddddddddddd1',
          '018f6c5b-21a4-789a-8def-eeeeeeeeeee1',
        ),
      ),
      adapter.enqueueAnalysisAtomic(
        makeParams(
          op2,
          '018f6c5b-21a4-789a-8def-bbbbbbbbbbb2',
          '018f6c5b-21a4-789a-8def-ccccccccccc2',
          '018f6c5b-21a4-789a-8def-ddddddddddd2',
          '018f6c5b-21a4-789a-8def-eeeeeeeeeee2',
        ),
      ),
    ]);

    expect([res1.cached, res2.cached].filter(Boolean)).toHaveLength(1);
    const winnerOpId = !res1.cached ? res1.operationId : res2.operationId;
    expect(res1.operationId).toBe(winnerOpId);
    expect(res2.operationId).toBe(winnerOpId);
  });
});
