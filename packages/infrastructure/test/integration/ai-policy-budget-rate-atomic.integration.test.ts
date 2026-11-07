import pg from 'pg';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseAIRunId,
  parseAuditEventId,
  parseJobExecutionId,
  parseOperationId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { PostgresAnalysisAdapter } from '../../src/analysis/postgres-analysis-adapter.js';
import {
  AIDisabledError,
  AIBudgetExhaustedError,
  AIRateLimitExceededError,
} from '@affiliate-content-os/application';

describe('ai-policy-budget-rate-atomic.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresAnalysisAdapter;

  const wsSafeDefault = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001');
  const wsBudgetRate = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000002');
  const userId = parseUserId('018f6c5b-21a4-789a-8def-000000000003');
  const prodId = parseProductId('018f6c5b-21a4-789a-8def-000000000004');
  const factSetId = parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000005');
  const prodSafeId = parseProductId('018f6c5b-21a4-789a-8def-000000000006');

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresAnalysisAdapter(pool);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-policy', 'policy@example.com', 'Policy User', 'active', NOW(), NOW(), 1)`,
      [userId],
    );

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'WS Safe', 'ws-safe', 'UTC', 'active', NOW(), NOW(), 1),
              ($2, 'WS Budget', 'ws-budget', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsSafeDefault, wsBudgetRate],
    );

    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Prod Budget', 'Merchant', 'https://example.com/pb', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prodId, wsBudgetRate, Buffer.alloc(32, 1)],
    );

    await pool.query(
      `INSERT INTO product_fact_sets (
         id, workspace_id, product_id, revision_number, status, created_by_user_id,
         confirmed_by_user_id, confirmed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 1, 'confirmed', $4, $4, NOW(), NOW(), NOW(), 1)`,
      [factSetId, wsBudgetRate, prodId, userId],
    );

    // Also insert product in wsSafeDefault
    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Prod Safe', 'Merchant', 'https://example.com/ps', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prodSafeId, wsSafeDefault, Buffer.alloc(32, 2)],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  function makeEnqueueParams(
    ws: WorkspaceId,
    opId: string,
    jobId: string,
    estimatedCost: number,
    customKeyHash?: Buffer,
  ) {
    const keyHash =
      customKeyHash ?? crypto.createHash('sha256').update(`${ws}:${opId}:${jobId}`).digest();
    const reqHash = Buffer.alloc(32, 7);
    const parsedOpId = parseOperationId(opId);
    const parsedAiRunId = parseAIRunId('018f6c5b-21a4-789a-8def-' + opId.slice(-12));
    const parsedJobId = parseJobExecutionId(jobId);

    return {
      operation: {
        id: parsedOpId,
        workspaceId: ws,
        operationType: 'product_analysis' as const,
        resourceType: 'product' as const,
        resourceId: ws === wsBudgetRate ? prodId : prodSafeId,
        requestedByUserId: userId,
      },
      aiRun: {
        id: parsedAiRunId,
        workspaceId: ws,
        operationId: parsedOpId,
        purpose: 'product_analysis' as const,
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
        id: parsedJobId,
        workspaceId: ws,
        operationId: parsedOpId,
        aiRunId: parsedAiRunId,
        jobType: 'ai_analysis',
        deduplicationKey: `product:${prodId}:${jobId}`,
        reservedSpendMicrounits: estimatedCost,
        payloadJson: { opId },
      },
      outboxEvent: {
        id: '018f6c5b-21a4-789a-8def-' + opId.slice(-12),
        workspaceId: ws,
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
      estimatedCostMicrounits: estimatedCost,
      auditEvent: {
        id: '018f6c5b-21a4-789a-8def-' + opId.slice(-12),
        workspaceId: ws,
        actorUserId: userId,
        action: 'ai_analysis.enqueued',
        resourceType: 'operation',
        resourceId: opId,
        changesJson: { opId },
      },
    };
  }

  it('safe defaults: fails with AIDisabledError if workspace has no policy row or ai_enabled is false', async () => {
    // 1. No policy row in wsSafeDefault
    await expect(
      adapter.enqueueAnalysisAtomic(
        makeEnqueueParams(
          wsSafeDefault,
          '018f6c5b-21a4-789a-8def-111111111111',
          '018f6c5b-21a4-789a-8def-111111111112',
          10000,
        ),
      ),
    ).rejects.toThrow(AIDisabledError);

    // 2. Policy row with ai_enabled = false
    await pool.query(
      `INSERT INTO workspace_ai_policies (workspace_id, ai_enabled, monthly_budget_microunits, current_spend_microunits, reserved_spend_microunits, rate_limit_per_minute, budget_period_start, minute_window_start, minute_request_count, updated_at, version)
       VALUES ($1, false, 1000000, 0, 0, 10, NOW(), NOW(), 0, NOW(), 1)`,
      [wsSafeDefault],
    );

    await expect(
      adapter.enqueueAnalysisAtomic(
        makeEnqueueParams(
          wsSafeDefault,
          '018f6c5b-21a4-789a-8def-111111111113',
          '018f6c5b-21a4-789a-8def-111111111114',
          10000,
        ),
      ),
    ).rejects.toThrow(AIDisabledError);
  });

  it('updates AI policy with optimistic concurrency and an atomic audit event', async () => {
    const before = await adapter.getPolicy(wsSafeDefault);
    const auditEventId = parseAuditEventId('018f6c5b-21a4-789a-8def-999999999991');
    const updated = await adapter.updatePolicy({
      workspaceId: wsSafeDefault,
      aiEnabled: true,
      monthlyBudgetMicrounits: 75_000,
      rateLimitPerMinute: 25,
      expectedVersion: before.version,
      actorUserId: userId,
      auditEventId,
    });

    expect(updated.version).toBe(before.version + 1);
    const audit = await pool.query(
      `SELECT action, actor_user_id, changes_json FROM audit_events WHERE id = $1`,
      [auditEventId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].action).toBe('workspace.ai_policy.updated');
    expect(audit.rows[0].actor_user_id).toBe(userId);
    expect(audit.rows[0].changes_json).toEqual({
      ai_enabled: true,
      monthly_budget_microunits: 75_000,
      rate_limit_per_minute: 25,
    });

    await expect(
      adapter.updatePolicy({
        workspaceId: wsSafeDefault,
        aiEnabled: false,
        monthlyBudgetMicrounits: 75_000,
        rateLimitPerMinute: 25,
        expectedVersion: before.version,
        actorUserId: userId,
        auditEventId: parseAuditEventId('018f6c5b-21a4-789a-8def-999999999992'),
      }),
    ).rejects.toThrow();
  });

  it('rate limiting and minute window rollover', async () => {
    // Seed wsBudgetRate with ai_enabled=true, budget=1,000,000, rate_limit=2
    await pool.query(
      `INSERT INTO workspace_ai_policies (workspace_id, ai_enabled, monthly_budget_microunits, current_spend_microunits, reserved_spend_microunits, rate_limit_per_minute, budget_period_start, minute_window_start, minute_request_count, updated_at, version)
       VALUES ($1, true, 1000000, 0, 0, 2, NOW(), NOW(), 0, NOW(), 1)`,
      [wsBudgetRate],
    );

    // Request 1 succeeds (minute count 0 -> 1)
    await adapter.enqueueAnalysisAtomic(
      makeEnqueueParams(
        wsBudgetRate,
        '018f6c5b-21a4-789a-8def-222222222221',
        '018f6c5b-21a4-789a-8def-222222222222',
        10000,
      ),
    );

    // Request 2 succeeds (minute count 1 -> 2)
    await adapter.enqueueAnalysisAtomic(
      makeEnqueueParams(
        wsBudgetRate,
        '018f6c5b-21a4-789a-8def-222222222223',
        '018f6c5b-21a4-789a-8def-222222222224',
        10000,
      ),
    );

    // Request 3 exceeds rate limit -> fails with AIRateLimitExceededError
    await expect(
      adapter.enqueueAnalysisAtomic(
        makeEnqueueParams(
          wsBudgetRate,
          '018f6c5b-21a4-789a-8def-222222222225',
          '018f6c5b-21a4-789a-8def-222222222226',
          10000,
        ),
      ),
    ).rejects.toThrow(AIRateLimitExceededError);

    // Rollover: simulate minute window expiration (> 60 seconds ago)
    await pool.query(
      `UPDATE workspace_ai_policies SET minute_window_start = NOW() - INTERVAL '65 seconds' WHERE workspace_id = $1`,
      [wsBudgetRate],
    );

    // Request 4 now succeeds and resets minute window
    const res = await adapter.enqueueAnalysisAtomic(
      makeEnqueueParams(
        wsBudgetRate,
        '018f6c5b-21a4-789a-8def-222222222227',
        '018f6c5b-21a4-789a-8def-222222222228',
        10000,
      ),
    );
    expect(res.operationId).toBe('018f6c5b-21a4-789a-8def-222222222227');

    const policy = await pool.query(
      `SELECT minute_request_count FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsBudgetRate],
    );
    expect(policy.rows[0].minute_request_count).toBe(1);
  });

  it('monthly budget exhaustion and 30-day period rollover', async () => {
    // Current spend is 0, reserved is 30,000 (from 3 requests above). Let's set monthly budget to 50,000.
    await pool.query(
      `UPDATE workspace_ai_policies
       SET monthly_budget_microunits = 50000, rate_limit_per_minute = 100
       WHERE workspace_id = $1`,
      [wsBudgetRate],
    );

    // Attempting an enqueue with cost 25,000 (30,000 + 25,000 = 55,000 > 50,000) -> fails with AIBudgetExhaustedError
    await expect(
      adapter.enqueueAnalysisAtomic(
        makeEnqueueParams(
          wsBudgetRate,
          '018f6c5b-21a4-789a-8def-333333333331',
          '018f6c5b-21a4-789a-8def-333333333332',
          25000,
        ),
      ),
    ).rejects.toThrow(AIBudgetExhaustedError);

    // Monthly rollover: simulate period start > 30 days ago
    await pool.query(
      `UPDATE workspace_ai_policies
       SET current_spend_microunits = 45000,
           reserved_spend_microunits = 0,
           budget_period_start = NOW() - INTERVAL '31 days'
       WHERE workspace_id = $1`,
      [wsBudgetRate],
    );

    // Request with cost 25,000 now succeeds because current_spend reset to 0
    const res = await adapter.enqueueAnalysisAtomic(
      makeEnqueueParams(
        wsBudgetRate,
        '018f6c5b-21a4-789a-8def-333333333333',
        '018f6c5b-21a4-789a-8def-333333333334',
        25000,
      ),
    );
    expect(res.operationId).toBe('018f6c5b-21a4-789a-8def-333333333333');

    const policy = await pool.query(
      `SELECT current_spend_microunits, reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsBudgetRate],
    );
    expect(policy.rows[0].current_spend_microunits).toBe('0');
    expect(policy.rows[0].reserved_spend_microunits).toBe('25000');
  });

  it('concurrent enqueue budget competition: exactly one succeeds when budget allows only one', async () => {
    // Set budget to 30,000. Currently reserved is 25,000, so only 5,000 remaining.
    // Reset reserved to 0, current spend to 20,000 -> remaining budget = 10,000.
    // Two concurrent requests each ask for 8,000. Exactly 1 can succeed, 1 must fail with budget exhausted.
    await pool.query(
      `UPDATE workspace_ai_policies
       SET monthly_budget_microunits = 30000,
           current_spend_microunits = 20000,
           reserved_spend_microunits = 0,
           rate_limit_per_minute = 100,
           budget_period_start = NOW()
       WHERE workspace_id = $1`,
      [wsBudgetRate],
    );

    const req1 = adapter.enqueueAnalysisAtomic(
      makeEnqueueParams(
        wsBudgetRate,
        '018f6c5b-21a4-789a-8def-444444444441',
        '018f6c5b-21a4-789a-8def-444444444442',
        8000,
      ),
    );
    const req2 = adapter.enqueueAnalysisAtomic(
      makeEnqueueParams(
        wsBudgetRate,
        '018f6c5b-21a4-789a-8def-444444444443',
        '018f6c5b-21a4-789a-8def-444444444444',
        8000,
      ),
    );

    const results = await Promise.allSettled([req1, req2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AIBudgetExhaustedError);
  });

  it('second legitimate analysis for same product/fact set succeeds with distinct idempotency key', async () => {
    // Increase budget so requests succeed
    await pool.query(
      `UPDATE workspace_ai_policies
       SET monthly_budget_microunits = 1000000, rate_limit_per_minute = 100
       WHERE workspace_id = $1`,
      [wsBudgetRate],
    );

    const first = await adapter.enqueueAnalysisAtomic(
      makeEnqueueParams(
        wsBudgetRate,
        '018f6c5b-21a4-789a-8def-555555555551',
        '018f6c5b-21a4-789a-8def-555555555552',
        5000,
      ),
    );
    expect(first.operationId).toBe('018f6c5b-21a4-789a-8def-555555555551');

    // Second legitimate analysis for the exact same product and fact set with different key
    const second = await adapter.enqueueAnalysisAtomic(
      makeEnqueueParams(
        wsBudgetRate,
        '018f6c5b-21a4-789a-8def-555555555553',
        '018f6c5b-21a4-789a-8def-555555555554',
        5000,
      ),
    );
    expect(second.operationId).toBe('018f6c5b-21a4-789a-8def-555555555553');
    expect(second.operationId).not.toBe(first.operationId);
  });
});
