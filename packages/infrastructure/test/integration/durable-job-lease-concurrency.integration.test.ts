import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseAIRunId,
  parseAnalysisId,
  parseJobExecutionId,
  parseOperationId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { PostgresJobAdapter } from '../../src/jobs/postgres-job-adapter.js';
import { PostgresAnalysisAdapter } from '../../src/analysis/postgres-analysis-adapter.js';

describe('durable-job-lease-concurrency.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let jobAdapter: PostgresJobAdapter;
  let analysisAdapter: PostgresAnalysisAdapter;

  const wsId = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001');
  const userId = parseUserId('018f6c5b-21a4-789a-8def-000000000002');
  const prodId = parseProductId('018f6c5b-21a4-789a-8def-000000000003');
  const factSetId = parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000004');
  const op1Id = parseOperationId('018f6c5b-21a4-789a-8def-000000000011');
  const op2Id = parseOperationId('018f6c5b-21a4-789a-8def-000000000021');
  const run1Id = parseAIRunId('018f6c5b-21a4-789a-8def-000000000012');
  const run2Id = parseAIRunId('018f6c5b-21a4-789a-8def-000000000022');
  const job1Id = parseJobExecutionId('018f6c5b-21a4-789a-8def-000000000010');
  const job2Id = parseJobExecutionId('018f6c5b-21a4-789a-8def-000000000020');

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    jobAdapter = new PostgresJobAdapter(pool);
    analysisAdapter = new PostgresAnalysisAdapter(pool);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-job', 'job@example.com', 'Job User', 'active', NOW(), NOW(), 1)`,
      [userId],
    );

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Job WS', 'job-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId],
    );

    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Job Prod', 'Merchant', 'https://example.com/jp', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
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
       ) VALUES ($1, true, 100000000, 0, 100000, 10, NOW(), NOW(), 0, NOW(), 1)`,
      [wsId],
    );

    await pool.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, requested_by_user_id, created_at, updated_at, version
       ) VALUES
       ($1, $3, 'product_analysis', 'product', $4, 'queued', $5, NOW(), NOW(), 1),
       ($2, $3, 'product_analysis', 'product', $4, 'queued', $5, NOW(), NOW(), 1)`,
      [op1Id, op2Id, wsId, prodId, userId],
    );

    await pool.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, status, requested_by_user_id, created_at, updated_at, version
       ) VALUES
       ($1, $3, $4, 'product_analysis', 'google', 'gemini-2.5-flash', 'tmpl', '1.0', 1, 1, $6, 'queued', $7, NOW(), NOW(), 1),
       ($2, $3, $5, 'product_analysis', 'google', 'gemini-2.5-flash', 'tmpl', '1.0', 1, 1, $6, 'queued', $7, NOW(), NOW(), 1)`,
      [run1Id, run2Id, wsId, op1Id, op2Id, Buffer.alloc(32, 2), userId],
    );

    // Insert two runnable queued jobs
    await pool.query(
      `INSERT INTO job_executions (
         id, workspace_id, operation_id, ai_run_id, job_type, deduplication_key, status,
         attempt, max_attempts, next_attempt_at, payload_json, reserved_spend_microunits, created_at, updated_at, version
       ) VALUES
       ($1, $3, $4, $5, 'ai_analysis', 'key-1', 'queued', 0, 3, NOW() - INTERVAL '10 seconds', '{}', 50000, NOW(), NOW(), 1),
       ($2, $3, $6, $7, 'ai_analysis', 'key-2', 'queued', 0, 3, NOW() - INTERVAL '5 seconds', '{}', 50000, NOW(), NOW(), 1)`,
      [job1Id, job2Id, wsId, op1Id, run1Id, op2Id, run2Id],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('concurrent worker claims: two simultaneous workers acquire distinct jobs and never the same lease', async () => {
    const [claim1, claim2] = await Promise.all([
      jobAdapter.claimNextJob({ workerId: 'worker-A', leaseDurationSeconds: 30 }),
      jobAdapter.claimNextJob({ workerId: 'worker-B', leaseDurationSeconds: 30 }),
    ]);

    expect(claim1).not.toBeNull();
    expect(claim2).not.toBeNull();
    expect(claim1!.id).not.toBe(claim2!.id);
    expect(claim1!.status).toBe('running');
    expect(claim2!.status).toBe('running');
    expect(claim1!.leaseOwner).toBe('worker-A');
    expect(claim2!.leaseOwner).toBe('worker-B');
    expect(claim1!.attempt).toBe(1);
    expect(claim2!.attempt).toBe(1);

    // A third worker finds no runnable job
    const claim3 = await jobAdapter.claimNextJob({
      workerId: 'worker-C',
      leaseDurationSeconds: 30,
    });
    expect(claim3).toBeNull();
  });

  it('completing a job marks it succeeded and releases the lease', async () => {
    // Complete job 1 via persistExecutionResultAtomic
    const job1Row = await pool.query('SELECT version FROM job_executions WHERE id = $1', [job1Id]);
    const version = Number(job1Row.rows[0].version);

    await analysisAdapter.persistExecutionResultAtomic({
      workspaceId: wsId,
      operationId: op1Id,
      aiRunId: run1Id,
      jobId: job1Id,
      jobVersion: version,
      workerId: 'worker-A',
      outcome: {
        kind: 'success',
        resultLocation: `/api/v1/workspaces/${wsId}/analyses/018f6c5b-21a4-789a-8def-000000000099`,
        analysis: {
          id: parseAnalysisId('018f6c5b-21a4-789a-8def-000000000099'),
          workspaceId: wsId,
          productId: prodId,
          analysisType: 'product',
          revisionNumber: 1,
          factSetId,
          aiRunId: run1Id,
          contentJson: { summary: 'Completed successfully' },
          schemaVersion: 1,
          createdByUserId: userId,
          subjects: [],
        },
        outputHash: Buffer.alloc(32, 4),
        usage: {
          tokenInput: 10,
          tokenOutput: 20,
          costMicrounits: 500,
          costCurrency: 'USD',
          latencyMs: 100,
        },
        actualSpendMicrounits: 500,
        reservedMicrounits: 50000,
        auditEvent: {
          id: '018f6c5b-21a4-789a-8def-000000000098',
          workspaceId: wsId,
          actorUserId: userId,
          action: 'ai_analysis.succeeded',
          resourceType: 'operation',
          resourceId: op1Id,
          result: 'succeeded',
          changesJson: {},
        },
      },
    });

    const updated = await pool.query('SELECT * FROM job_executions WHERE id = $1', [job1Id]);
    expect(updated.rows[0].status).toBe('succeeded');
    expect(updated.rows[0].lease_owner).toBeNull();
    expect(updated.rows[0].lease_expires_at).toBeNull();
  });

  it('expired lease can be reclaimed safely by another worker', async () => {
    // Manually expire job 2's lease
    await pool.query(
      `UPDATE job_executions
       SET lease_expires_at = NOW() - INTERVAL '5 seconds'
       WHERE id = $1`,
      [job2Id],
    );

    // Worker C can now reclaim job 2
    const reclaimed = await jobAdapter.claimNextJob({
      workerId: 'worker-C',
      leaseDurationSeconds: 30,
    });
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.id).toBe(job2Id);
    expect(reclaimed!.leaseOwner).toBe('worker-C');
    expect(reclaimed!.attempt).toBe(2); // Attempt count incremented to 2
  });

  it('transient failure transitions job to retry_wait with backoff', async () => {
    const jobRow = await pool.query('SELECT version FROM job_executions WHERE id = $1', [job2Id]);
    const version = Number(jobRow.rows[0].version);

    await analysisAdapter.persistExecutionResultAtomic({
      workspaceId: wsId,
      operationId: op2Id,
      aiRunId: run2Id,
      jobId: job2Id,
      jobVersion: version,
      workerId: 'worker-C',
      outcome: {
        kind: 'retry',
        retryDelaySeconds: 60,
        errorCategory: 'provider_timeout',
        reservedMicrounits: 50000,
      },
    });

    const updated = await pool.query('SELECT * FROM job_executions WHERE id = $1', [job2Id]);
    expect(updated.rows[0].status).toBe('retry_wait');
    expect(updated.rows[0].last_error_category).toBe('provider_timeout');
    expect(updated.rows[0].lease_owner).toBeNull();
  });

  it('enforces exactly one structured-output repair attempt before terminal failure', async () => {
    const job3Id = parseJobExecutionId('018f6c5b-21a4-789a-8def-000000000030');
    const op3Id = parseOperationId('018f6c5b-21a4-789a-8def-000000000031');
    const run3Id = parseAIRunId('018f6c5b-21a4-789a-8def-000000000032');

    await pool.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'queued', $4, NOW(), NOW(), 1)`,
      [op3Id, wsId, prodId, userId],
    );

    await pool.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, status, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product_analysis', 'google', 'gemini-2.5-flash', 'tmpl', '1.0', 1, 1, $4, 'queued', $5, NOW(), NOW(), 1)`,
      [run3Id, wsId, op3Id, Buffer.alloc(32, 3), userId],
    );

    await pool.query(
      `INSERT INTO job_executions (
         id, workspace_id, operation_id, ai_run_id, job_type, deduplication_key, status,
         attempt, max_attempts, next_attempt_at, payload_json, reserved_spend_microunits, created_at, updated_at, version
       ) VALUES ($1, $2, $3, $4, 'ai_analysis', 'key-repair-test', 'queued', 0, 3, NOW() - INTERVAL '1 second', '{}', 50000, NOW(), NOW(), 1)`,
      [job3Id, wsId, op3Id, run3Id],
    );

    const claimed = await jobAdapter.claimNextJob({
      workerId: 'worker-repair',
      leaseDurationSeconds: 30,
    });
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(job3Id);
    expect(claimed!.repairAttempt).toBe(0);

    // 1st repair attempt for invalid_output -> succeeds and transitions to retry_wait
    const repair1Res = await analysisAdapter.persistExecutionResultAtomic({
      workspaceId: wsId,
      operationId: op3Id,
      aiRunId: run3Id,
      jobId: job3Id,
      jobVersion: claimed!.version,
      workerId: 'worker-repair',
      outcome: {
        kind: 'repair',
        errorCategory: 'invalid_output',
        repairDelaySeconds: 10,
        reservedMicrounits: 50000,
      },
    });
    expect(repair1Res.outcome).toBe('repaired');

    const afterRepair1 = await pool.query('SELECT * FROM job_executions WHERE id = $1', [job3Id]);
    expect(afterRepair1.rows[0].status).toBe('retry_wait');
    expect(afterRepair1.rows[0].repair_attempt).toBe(1);
    expect(afterRepair1.rows[0].last_error_category).toBe('invalid_output');

    // Claim the repair job for attempt 2
    await pool.query(
      `UPDATE job_executions SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [job3Id],
    );
    const claimedRepair = await jobAdapter.claimNextJob({
      workerId: 'worker-repair',
      leaseDurationSeconds: 30,
    });
    expect(claimedRepair).not.toBeNull();
    expect(claimedRepair!.id).toBe(job3Id);
    expect(claimedRepair!.repairAttempt).toBe(1);

    // A second repair request is atomically down-converted to terminal failure.
    const exhaustedRepair = await analysisAdapter.persistExecutionResultAtomic({
      workspaceId: wsId,
      operationId: op3Id,
      aiRunId: run3Id,
      jobId: job3Id,
      jobVersion: claimedRepair!.version,
      workerId: 'worker-repair',
      outcome: {
        kind: 'repair',
        errorCategory: 'invalid_output',
        repairDelaySeconds: 10,
        reservedMicrounits: 50000,
      },
    });
    expect(exhaustedRepair).toEqual({ outcome: 'failed', errorCategory: 'invalid_output' });

    const terminalRow = await pool.query('SELECT * FROM job_executions WHERE id = $1', [job3Id]);
    expect(terminalRow.rows[0].status).toBe('failed');
    expect(terminalRow.rows[0].last_error_category).toBe('invalid_output');
    expect(terminalRow.rows[0].completed_at).not.toBeNull();
  });
});
