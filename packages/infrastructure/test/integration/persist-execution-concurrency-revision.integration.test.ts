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
import type {
  CreateAnalysisSubjectParams,
  PersistExecutionResultAtomicParams,
} from '@affiliate-content-os/application';
import { JobLeaseExpiredError } from '@affiliate-content-os/application';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { PostgresAnalysisAdapter } from '../../src/analysis/postgres-analysis-adapter.js';

describe('persist-execution-concurrency-revision.integration', () => {
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
       VALUES ($1, 'google', 'sub-rev', 'rev@example.com', 'Rev User', 'active', NOW(), NOW(), 1)`,
      [userId],
    );

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at, version)
       VALUES ($1, 'Rev WS', 'rev-ws', 'UTC', 'active', NOW(), NOW(), 1)`,
      [wsId],
    );

    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'Rev Prod', 'Merchant', 'https://example.com/rp', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
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
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  async function seedJobAndRun(
    opId: string,
    runId: string,
    jobId: string,
    leaseOwner: string | null = 'worker-1',
    leaseExpired = false,
  ) {
    await pool.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'running', $4, NOW(), NOW(), 1)`,
      [opId, wsId, prodId, userId],
    );

    await pool.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, status, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product_analysis', 'google', 'gemini-2.5-flash', 'tmpl', '1.0', 1, 1, $4, 'running', $5, NOW(), NOW(), 1)`,
      [runId, wsId, opId, Buffer.alloc(32, 2), userId],
    );

    const leaseExpiryInterval = leaseExpired
      ? "- INTERVAL '10 seconds'"
      : "+ INTERVAL '60 seconds'";
    await pool.query(
      `INSERT INTO job_executions (
         id, workspace_id, operation_id, ai_run_id, job_type, deduplication_key, status,
         attempt, max_attempts, max_repair_attempts, lease_owner, lease_expires_at, next_attempt_at, started_at,
         payload_json, created_at, updated_at, version
       ) VALUES ($1, $2, $3, $4, 'ai_analysis', $5, 'running', 1, 3, 1, $6, NOW() ${leaseExpiryInterval}, NOW(), NOW(), '{}', NOW(), NOW(), 1)`,
      [jobId, wsId, opId, runId, `dedup-${jobId}`, leaseOwner],
    );
  }

  function makePersistParams(
    opId: string,
    runId: string,
    jobId: string,
    analysisId: string,
    jobVersion = 1,
    customSubject?: CreateAnalysisSubjectParams,
    workerId = 'worker-1',
  ): PersistExecutionResultAtomicParams {
    const parsedOpId = parseOperationId(opId);
    const parsedRunId = parseAIRunId(runId);
    const parsedJobId = parseJobExecutionId(jobId);
    const parsedAnalysisId = parseAnalysisId(analysisId);

    const subjects: CreateAnalysisSubjectParams[] = customSubject
      ? [customSubject]
      : [
          {
            subjectType: 'product',
            role: 'primary_subject',
            subjectProductId: prodId,
          },
        ];

    return {
      workspaceId: wsId,
      operationId: parsedOpId,
      aiRunId: parsedRunId,
      jobId: parsedJobId,
      jobVersion,
      workerId,
      outcome: {
        kind: 'success',
        analysis: {
          id: parsedAnalysisId,
          workspaceId: wsId,
          productId: prodId,
          analysisType: 'product',
          factSetId,
          aiRunId: parsedRunId,
          contentJson: { summary: 'Analysis success' },
          schemaVersion: 1,
          createdByUserId: userId,
          subjects,
        },
        outputHash: new Uint8Array(32).fill(9),
        usage: {
          tokenInput: 50,
          tokenOutput: 100,
          costMicrounits: 10000,
          costCurrency: 'USD',
          latencyMs: 500,
        },
        resultLocation: `/analyses/${analysisId}`,
        reservedMicrounits: 15000,
        actualSpendMicrounits: 10000,
        auditEvent: {
          id: '018f6c5b-21a4-789a-8def-' + analysisId.slice(-12),
          workspaceId: wsId,
          actorUserId: userId,
          action: 'ai_analysis.completed',
          resourceType: 'analysis',
          resourceId: analysisId,
          result: 'succeeded',
          changesJson: { analysisId },
        },
      },
    };
  }

  it('concurrent revision allocation: two workers persisting for same product receive consecutive revisions', async () => {
    const op1 = '018f6c5b-21a4-789a-8def-100000000001';
    const run1 = '018f6c5b-21a4-789a-8def-100000000002';
    const job1 = '018f6c5b-21a4-789a-8def-100000000003';
    const analysis1 = '018f6c5b-21a4-789a-8def-100000000004';

    const op2 = '018f6c5b-21a4-789a-8def-200000000001';
    const run2 = '018f6c5b-21a4-789a-8def-200000000002';
    const job2 = '018f6c5b-21a4-789a-8def-200000000003';
    const analysis2 = '018f6c5b-21a4-789a-8def-200000000004';

    await seedJobAndRun(op1, run1, job1);
    await seedJobAndRun(op2, run2, job2);

    const call1 = adapter.persistExecutionResultAtomic(
      makePersistParams(op1, run1, job1, analysis1),
    );
    const call2 = adapter.persistExecutionResultAtomic(
      makePersistParams(op2, run2, job2, analysis2),
    );

    await Promise.all([call1, call2]);

    const a1Row = await pool.query('SELECT revision_number FROM analyses WHERE id = $1', [
      analysis1,
    ]);
    const a2Row = await pool.query('SELECT revision_number FROM analyses WHERE id = $1', [
      analysis2,
    ]);

    const revs = [
      Number(a1Row.rows[0].revision_number),
      Number(a2Row.rows[0].revision_number),
    ].sort();
    expect(revs).toEqual([1, 2]);
  });

  it('lease expiry and stale worker fencing throws JobLeaseExpiredError without modifying DB', async () => {
    const op = '018f6c5b-21a4-789a-8def-300000000001';
    const run = '018f6c5b-21a4-789a-8def-300000000002';
    const job = '018f6c5b-21a4-789a-8def-300000000003';
    const analysis = '018f6c5b-21a4-789a-8def-300000000004';

    // Seed with expired lease
    await seedJobAndRun(op, run, job, 'worker-stale', true);

    await expect(
      adapter.persistExecutionResultAtomic(
        makePersistParams(op, run, job, analysis, 1, undefined, 'worker-stale'),
      ),
    ).rejects.toThrow(JobLeaseExpiredError);

    const check = await pool.query('SELECT * FROM analyses WHERE id = $1', [analysis]);
    expect(check.rows).toHaveLength(0);

    // Stale version check: seed job with active lease, but pass wrong version (e.g. version 99)
    const opV = '018f6c5b-21a4-789a-8def-400000000001';
    const runV = '018f6c5b-21a4-789a-8def-400000000002';
    const jobV = '018f6c5b-21a4-789a-8def-400000000003';
    const analysisV = '018f6c5b-21a4-789a-8def-400000000004';

    await seedJobAndRun(opV, runV, jobV, 'worker-active', false);
    await expect(
      adapter.persistExecutionResultAtomic(
        makePersistParams(opV, runV, jobV, analysisV, 99, undefined, 'worker-active'),
      ),
    ).rejects.toThrow(JobLeaseExpiredError);

    // Mismatched workerId check
    await expect(
      adapter.persistExecutionResultAtomic(
        makePersistParams(opV, runV, jobV, analysisV, 1, undefined, 'worker-different'),
      ),
    ).rejects.toThrow(JobLeaseExpiredError);

    // Mismatched operationId check (structural linkage)
    await expect(
      adapter.persistExecutionResultAtomic(
        makePersistParams(
          '018f6c5b-21a4-789a-8def-999999999999',
          runV,
          jobV,
          analysisV,
          1,
          undefined,
          'worker-active',
        ),
      ),
    ).rejects.toThrow(JobLeaseExpiredError);
  });

  it('redelivery after success is an idempotent no-op', async () => {
    const op = '018f6c5b-21a4-789a-8def-500000000001';
    const run = '018f6c5b-21a4-789a-8def-500000000002';
    const job = '018f6c5b-21a4-789a-8def-500000000003';
    const analysis = '018f6c5b-21a4-789a-8def-500000000004';

    await seedJobAndRun(op, run, job);
    await adapter.persistExecutionResultAtomic(makePersistParams(op, run, job, analysis));

    // Call again -> must succeed quietly without creating duplicates or failing
    await expect(
      adapter.persistExecutionResultAtomic(makePersistParams(op, run, job, analysis)),
    ).resolves.not.toThrow();

    const check = await pool.query('SELECT COUNT(*) AS count FROM analyses WHERE id = $1', [
      analysis,
    ]);
    expect(Number(check.rows[0].count)).toBe(1);
  });

  it('atomic rollback on subject constraint failure', async () => {
    const op = '018f6c5b-21a4-789a-8def-600000000001';
    const run = '018f6c5b-21a4-789a-8def-600000000002';
    const job = '018f6c5b-21a4-789a-8def-600000000003';
    const analysis = '018f6c5b-21a4-789a-8def-600000000004';

    await seedJobAndRun(op, run, job);

    // Invalid subject: subject_product_id pointing to non-existent product
    const badSubject: CreateAnalysisSubjectParams = {
      subjectType: 'product',
      role: 'primary_subject',
      subjectProductId: parseProductId('018f6c5b-21a4-789a-8def-999999999999'),
    };

    await expect(
      adapter.persistExecutionResultAtomic(
        makePersistParams(op, run, job, analysis, 1, badSubject),
      ),
    ).rejects.toThrow();

    // Verify nothing persisted
    const analysisCheck = await pool.query('SELECT * FROM analyses WHERE id = $1', [analysis]);
    expect(analysisCheck.rows).toHaveLength(0);

    const opCheck = await pool.query('SELECT status FROM operations WHERE id = $1', [op]);
    expect(opCheck.rows[0].status).toBe('running');
  });

  it('retry outcome updates job to retry_wait and releases lease', async () => {
    const op = '018f6c5b-21a4-789a-8def-700000000001';
    const run = '018f6c5b-21a4-789a-8def-700000000002';
    const job = '018f6c5b-21a4-789a-8def-700000000003';

    await seedJobAndRun(op, run, job);

    const res = await adapter.persistExecutionResultAtomic({
      workspaceId: wsId,
      operationId: parseOperationId(op),
      aiRunId: parseAIRunId(run),
      jobId: parseJobExecutionId(job),
      jobVersion: 1,
      workerId: 'worker-1',
      outcome: {
        kind: 'retry',
        errorCategory: 'provider_timeout',
        retryDelaySeconds: 30,
        reservedMicrounits: 15000,
      },
    });

    expect(res.outcome).toBe('retried');

    const jobCheck = await pool.query(
      'SELECT status, last_error_category, lease_owner FROM job_executions WHERE id = $1',
      [job],
    );
    expect(jobCheck.rows[0].status).toBe('retry_wait');
    expect(jobCheck.rows[0].last_error_category).toBe('provider_timeout');
    expect(jobCheck.rows[0].lease_owner).toBeNull();
  });

  it('repair outcome updates job to retry_wait and sets is_repair on ai_run', async () => {
    const op = '018f6c5b-21a4-789a-8def-800000000001';
    const run = '018f6c5b-21a4-789a-8def-800000000002';
    const job = '018f6c5b-21a4-789a-8def-800000000003';

    await seedJobAndRun(op, run, job);

    const res = await adapter.persistExecutionResultAtomic({
      workspaceId: wsId,
      operationId: parseOperationId(op),
      aiRunId: parseAIRunId(run),
      jobId: parseJobExecutionId(job),
      jobVersion: 1,
      workerId: 'worker-1',
      outcome: {
        kind: 'repair',
        errorCategory: 'invalid_output',
        repairDelaySeconds: 5,
        reservedMicrounits: 15000,
      },
    });

    expect(res.outcome).toBe('repaired');

    const jobCheck = await pool.query(
      'SELECT status, repair_attempt, last_error_category FROM job_executions WHERE id = $1',
      [job],
    );
    expect(jobCheck.rows[0].status).toBe('retry_wait');
    expect(jobCheck.rows[0].repair_attempt).toBe(1);
    expect(jobCheck.rows[0].last_error_category).toBe('invalid_output');

    const runCheck = await pool.query('SELECT is_repair FROM ai_runs WHERE id = $1', [run]);
    expect(runCheck.rows[0].is_repair).toBe(true);
  });

  it('terminal failure outcome transitions operation, run, job to failed and records audit event', async () => {
    const op = '018f6c5b-21a4-789a-8def-900000000001';
    const run = '018f6c5b-21a4-789a-8def-900000000002';
    const job = '018f6c5b-21a4-789a-8def-900000000003';
    const auditId = '018f6c5b-21a4-789a-8def-900000000004';

    await seedJobAndRun(op, run, job);

    const res = await adapter.persistExecutionResultAtomic({
      workspaceId: wsId,
      operationId: parseOperationId(op),
      aiRunId: parseAIRunId(run),
      jobId: parseJobExecutionId(job),
      jobVersion: 1,
      workerId: 'worker-1',
      outcome: {
        kind: 'terminal_failure',
        errorCategory: 'invalid_output',
        errorCode: 'INVALID_OUTPUT',
        errorMessage: 'Output schema validation failed',
        reservedMicrounits: 15000,
        actualSpendMicrounits: 5000,
        auditEvent: {
          id: auditId,
          workspaceId: wsId,
          actorUserId: userId,
          action: 'ai_analysis.failed',
          resourceType: 'operation',
          resourceId: op,
          result: 'failed',
          changesJson: { error: 'INVALID_OUTPUT' },
        },
      },
    });

    expect(res.outcome).toBe('failed');

    const opCheck = await pool.query(
      'SELECT status, error_category, error_code, error_message FROM operations WHERE id = $1',
      [op],
    );
    expect(opCheck.rows[0].status).toBe('failed');
    expect(opCheck.rows[0].error_category).toBe('invalid_output');
    expect(opCheck.rows[0].error_code).toBe('INVALID_OUTPUT');

    const runCheck = await pool.query('SELECT status, error_category FROM ai_runs WHERE id = $1', [
      run,
    ]);
    expect(runCheck.rows[0].status).toBe('failed');
    expect(runCheck.rows[0].error_category).toBe('invalid_output');

    const jobCheck = await pool.query(
      'SELECT status, last_error_category FROM job_executions WHERE id = $1',
      [job],
    );
    expect(jobCheck.rows[0].status).toBe('failed');
    expect(jobCheck.rows[0].last_error_category).toBe('invalid_output');

    const auditCheck = await pool.query('SELECT * FROM audit_events WHERE id = $1', [auditId]);
    expect(auditCheck.rows).toHaveLength(1);
    expect(auditCheck.rows[0].result).toBe('failed');

    // Redelivery on terminal failed operation/job is idempotent no-op
    const redeliveryRes = await adapter.persistExecutionResultAtomic({
      workspaceId: wsId,
      operationId: parseOperationId(op),
      aiRunId: parseAIRunId(run),
      jobId: parseJobExecutionId(job),
      jobVersion: 1,
      workerId: 'worker-1',
      outcome: {
        kind: 'terminal_failure',
        errorCategory: 'invalid_output',
        errorCode: 'INVALID_OUTPUT',
        errorMessage: 'Output schema validation failed',
        reservedMicrounits: 15000,
        actualSpendMicrounits: 5000,
        auditEvent: {
          id: '018f6c5b-21a4-789a-8def-900000000099',
          workspaceId: wsId,
          actorUserId: userId,
          action: 'ai_analysis.failed',
          resourceType: 'operation',
          resourceId: op,
          result: 'failed',
          changesJson: { error: 'INVALID_OUTPUT' },
        },
      },
    });
    expect(redeliveryRes.outcome).toBe('failed');
  });
});
