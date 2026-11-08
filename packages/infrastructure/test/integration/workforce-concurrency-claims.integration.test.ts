import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import {
  seedWorkforceBaseData,
  createTestKickoffParams,
  FIXTURE_IDS,
} from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import { PostgresJobAdapter } from '../../src/jobs/postgres-job-adapter.js';

describe('workforce-concurrency-claims.integration (Item a)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId, ws2Id, prod2Id, userId } = FIXTURE_IDS;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresWorkforceAdapter(pool);
    jobAdapter = new PostgresJobAdapter(pool);
    await seedWorkforceBaseData(pool);

    // Setup WS2 product, policy, fact set, and accepted analyses for kickoff
    await pool.query(
      `INSERT INTO workspace_ai_policies (
         workspace_id, ai_enabled, rate_limit_per_minute, minute_request_count,
         monthly_budget_microunits, current_spend_microunits, reserved_spend_microunits, updated_at
       ) VALUES ($1, true, 60, 0, 1000000000, 0, 0, NOW())
       ON CONFLICT (workspace_id) DO UPDATE SET ai_enabled = true, monthly_budget_microunits = 1000000000`,
      [ws2Id],
    );

    await pool.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at, version)
       VALUES ('018f6c5b-21a4-789a-8def-000000000020', $1, $2, 'owner', 'active', NOW(), NOW(), NOW(), 1)`,
      [ws2Id, userId],
    );

    await pool.query(
      `INSERT INTO products (
         id, workspace_id, name, merchant_name, canonical_url, canonical_url_hash,
         category, description, status, current_fact_set_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'WF Product 2', 'Merchant 2', 'https://example.com/wf2', $3, 'Cat', 'Desc', 'active', null, NOW(), NOW(), 1)`,
      [prod2Id, ws2Id, Buffer.alloc(32, 2)],
    );

    const factSet2Id = '018f6c5b-21a4-789a-8def-000000000021';
    await pool.query(
      `INSERT INTO product_fact_sets (
         id, workspace_id, product_id, revision_number, status, created_by_user_id,
         confirmed_by_user_id, confirmed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 1, 'confirmed', $4, $4, NOW(), NOW(), NOW(), 1)`,
      [factSet2Id, ws2Id, prod2Id, userId],
    );

    await pool.query(`UPDATE products SET current_fact_set_id = $1 WHERE id = $2`, [
      factSet2Id,
      prod2Id,
    ]);

    const op2Id = '018f6c5b-21a4-789a-8def-000000000022';
    const run2Id = '018f6c5b-21a4-789a-8def-000000000023';
    await pool.query(
      `INSERT INTO operations (
         id, workspace_id, operation_type, resource_type, resource_id,
         status, result_location, started_at, completed_at, requested_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, 'product_analysis', 'product', $3, 'succeeded', '/res2', NOW(), NOW(), $4, NOW(), NOW(), 1)`,
      [op2Id, ws2Id, prod2Id, userId],
    );

    await pool.query(
      `INSERT INTO ai_runs (
         id, workspace_id, operation_id, purpose, provider, model,
         prompt_template, prompt_version, input_schema_version, output_schema_version,
         input_hash, output_hash, status, requested_by_user_id, started_at, completed_at, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product_analysis', 'google', 'gemini-2.5-flash', 'tmpl', '1.0', 1, 1, $4, $5, 'succeeded', $6, NOW(), NOW(), NOW(), NOW(), 1)`,
      [run2Id, ws2Id, op2Id, Buffer.alloc(32, 4), Buffer.alloc(32, 5), userId],
    );

    const an2Id = '018f6c5b-21a4-789a-8def-000000000024';
    await pool.query(
      `INSERT INTO analyses (
         id, workspace_id, product_id, analysis_type, revision_number,
         fact_set_id, ai_run_id, content_json, schema_version, status,
         reviewed_by_user_id, reviewed_at, review_reason, created_by_user_id, created_at, updated_at, version
       ) VALUES ($1, $2, $3, 'product', 1, $4, $5, '{}', 1, 'accepted', $6, NOW(), 'Approved', $6, NOW(), NOW(), 1)`,
      [an2Id, ws2Id, prod2Id, factSet2Id, run2Id, userId],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('enforces maximum 3 live workforce claims per workspace under concurrent race with another workspace claimable', async () => {
    // Kickoff 2 work orders in WS1 (6 planning jobs total for WS1)
    await adapter.kickoffWorkOrderAtomic(createTestKickoffParams());
    await adapter.kickoffWorkOrderAtomic(createTestKickoffParams({ priority: 60 }));

    // 1. Genuine concurrent race: 4 separate adapters/connections race to claim against WS1
    const adapters = Array.from({ length: 4 }, () => new PostgresJobAdapter(pool));
    const raceClaims = await Promise.all(
      adapters.map((ad, idx) =>
        ad.claimNextJob({ workerId: `concurrent-worker-${idx + 1}`, leaseDurationSeconds: 60 }),
      ),
    );

    // Prove exactly 3 live workforce jobs are returned for WS1 and the extra claim returned null
    const claimedWS1 = raceClaims.filter((c) => c !== null);
    const nullClaims = raceClaims.filter((c) => c === null);
    expect(claimedWS1).toHaveLength(3);
    expect(nullClaims).toHaveLength(1);
    for (const job of claimedWS1) {
      expect(job!.workspaceId).toBe(wsId);
      expect(job!.jobType).toBe('workforce_planning');
    }

    // Verify DB state: exactly 3 live running jobs with active leases for WS1
    const ws1Count = await pool.query(
      `SELECT count(*) FROM job_executions WHERE workspace_id = $1 AND status = 'running' AND lease_expires_at > NOW()`,
      [wsId],
    );
    expect(Number(ws1Count.rows[0].count)).toBe(3);

    // 2. Extra claim attempt on saturated WS1 still returns null and does not exceed capacity
    const extraClaim = await jobAdapter.claimNextJob({
      workerId: 'w-extra-claim',
      leaseDurationSeconds: 60,
    });
    expect(extraClaim).toBeNull();

    const ws1StillThree = await pool.query(
      `SELECT count(*) FROM job_executions WHERE workspace_id = $1 AND status = 'running' AND lease_expires_at > NOW()`,
      [wsId],
    );
    expect(Number(ws1StillThree.rows[0].count)).toBe(3);

    // 3. Kickoff 1 work order in WS2 (3 planning jobs for WS2)
    await adapter.kickoffWorkOrderAtomic(
      createTestKickoffParams({
        wsId: ws2Id,
        prodId: prod2Id,
        factSetId: '018f6c5b-21a4-789a-8def-000000000021' as never,
        sourceAnalyses: [{ id: '018f6c5b-21a4-789a-8def-000000000024' as never, version: 1 }],
      }),
    );

    // WS1 has remaining queued jobs but is saturated (3 active claims).
    // PostgreSQL must bypass saturated WS1 and prove WS2 remains claimable!
    const ws2Claim1 = await jobAdapter.claimNextJob({
      workerId: 'w-ws2-1',
      leaseDurationSeconds: 60,
    });
    expect(ws2Claim1).not.toBeNull();
    expect(ws2Claim1?.workspaceId).toBe(ws2Id);

    const ws2Claim2 = await jobAdapter.claimNextJob({
      workerId: 'w-ws2-2',
      leaseDurationSeconds: 60,
    });
    expect(ws2Claim2?.workspaceId).toBe(ws2Id);

    // 4. Artificially expire lease on first WS1 claim
    await pool.query(
      `UPDATE job_executions SET lease_expires_at = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
      [claimedWS1[0]!.id],
    );

    // Now WS1 has only 2 live non-expired leases. Next claim must claim from WS1!
    const ws1Reclaim = await jobAdapter.claimNextJob({
      workerId: 'w-reclaim',
      leaseDurationSeconds: 60,
    });
    expect(ws1Reclaim).not.toBeNull();
    expect(ws1Reclaim?.workspaceId).toBe(wsId);
  });
});
