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

describe('workforce-exhausted-sweep.integration (Item f)', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;
  let jobAdapter: PostgresJobAdapter;

  const { wsId } = FIXTURE_IDS;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresWorkforceAdapter(pool);
    jobAdapter = new PostgresJobAdapter(pool);
    await seedWorkforceBaseData(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('exhausted workforce job sweep updates work item, assignment, work order, and accounting', async () => {
    await adapter.kickoffWorkOrderAtomic(createTestKickoffParams());
    const claimedJob = await jobAdapter.claimNextJob({
      workerId: 'worker-exhausted-test',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob).not.toBeNull();
    const payload = claimedJob!.payloadJson as { workItemId: string; workOrderId: string };

    // Simulate attempts exhausted and lease expired in the past
    await pool.query(
      `UPDATE job_executions
       SET attempt = 3, max_attempts = 3, lease_expires_at = NOW() - INTERVAL '10 seconds'
       WHERE id = $1`,
      [claimedJob!.id],
    );

    // Call claimNextJob which executes sweepExhaustedJobs
    await jobAdapter.claimNextJob({ workerId: 'sweeper', leaseDurationSeconds: 30 });

    // 1. Verify job is marked failed
    const jobCheck = await pool.query(
      `SELECT status, last_error_category FROM job_executions WHERE id = $1`,
      [claimedJob!.id],
    );
    expect(jobCheck.rows[0].status).toBe('failed');
    expect(jobCheck.rows[0].last_error_category).toBe('provider_timeout');

    // 2. Verify work item is failed
    const wiCheck = await pool.query(`SELECT status FROM work_items WHERE id = $1`, [
      payload.workItemId,
    ]);
    expect(wiCheck.rows[0].status).toBe('failed');

    // 3. Verify agent assignment is failed
    const asgCheck = await pool.query(
      `SELECT office_state FROM agent_assignments WHERE work_item_id = $1`,
      [payload.workItemId],
    );
    expect(asgCheck.rows[0].office_state).toBe('failed');

    // 4. Verify work order is failed
    const woCheck = await pool.query(
      `SELECT status, failure_category FROM work_orders WHERE id = $1`,
      [payload.workOrderId],
    );
    expect(woCheck.rows[0].status).toBe('failed');
    expect(woCheck.rows[0].failure_category).toBe('provider_timeout');

    // 5. Verify policy reservation is released by 50,000 microunits (150,000 -> 100,000)
    const polCheck = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(polCheck.rows[0].reserved_spend_microunits)).toBe(100000);

    // 6. Verify audit event
    const auditRes = await pool.query(
      `SELECT action, resource_type, result FROM audit_events WHERE resource_id = $1`,
      [payload.workItemId],
    );
    expect(auditRes.rowCount).toBeGreaterThanOrEqual(1);
    expect(auditRes.rows[0].action).toBe('artifact.failed');
    expect(auditRes.rows[0].result).toBe('failed');
  });

  it('fails closed and rolls back if exact non-negative reservation release cannot occur (insufficient policy reservation)', async () => {
    // Clean up any remaining jobs/orders from previous test and reset policy reservations
    await pool.query(`DELETE FROM job_executions WHERE work_order_id IS NOT NULL`);
    await pool.query(
      `DELETE FROM ai_runs WHERE operation_id IN (SELECT id FROM operations WHERE work_order_id IS NOT NULL)`,
    );
    await pool.query(`DELETE FROM operations WHERE work_order_id IS NOT NULL`);
    await pool.query(`DELETE FROM agent_assignments`);
    await pool.query(`DELETE FROM work_item_dependencies`);
    await pool.query(`DELETE FROM work_items`);
    await pool.query(`DELETE FROM work_orders`);
    await pool.query(
      `UPDATE workspace_ai_policies SET reserved_spend_microunits = 0 WHERE workspace_id = $1`,
      [wsId],
    );

    await adapter.kickoffWorkOrderAtomic(createTestKickoffParams({ priority: 40 }));
    const claimedJob = await jobAdapter.claimNextJob({
      workerId: 'worker-insufficient-policy-test',
      leaseDurationSeconds: 30,
    });
    expect(claimedJob).not.toBeNull();
    const payload = claimedJob!.payloadJson as { workItemId: string; workOrderId: string };

    // Verify work order is currently in_progress before timeout sweep
    const woInitial = await pool.query(`SELECT status FROM work_orders WHERE id = $1`, [
      payload.workOrderId,
    ]);
    expect(woInitial.rows[0].status).toBe('in_progress');

    // Simulate attempts exhausted and lease expired in past
    await pool.query(
      `UPDATE job_executions
       SET attempt = 3, max_attempts = 3, lease_expires_at = NOW() - INTERVAL '10 seconds'
       WHERE id = $1`,
      [claimedJob!.id],
    );

    // Artificially zero out the policy's reserved spend so exact release of 50,000 cannot occur
    await pool.query(
      `UPDATE workspace_ai_policies
       SET reserved_spend_microunits = 0
       WHERE workspace_id = $1`,
      [wsId],
    );

    // claimNextJob triggers sweepExhaustedJobs, which must fail closed and roll back
    await expect(
      jobAdapter.claimNextJob({ workerId: 'sweeper-must-fail', leaseDurationSeconds: 30 }),
    ).rejects.toThrow(/Failed to release reserved budget for exhausted job/);

    // Verify NO partial terminalization or accounting occurred
    // 1. Job execution remains in running status, not failed
    const jobCheck = await pool.query(
      `SELECT status, last_error_category FROM job_executions WHERE id = $1`,
      [claimedJob!.id],
    );
    expect(jobCheck.rows[0].status).toBe('running');
    expect(jobCheck.rows[0].last_error_category).toBeNull();

    // 2. Work item remains in pre-sweep state (not failed)
    const wiCheck = await pool.query(`SELECT status FROM work_items WHERE id = $1`, [
      payload.workItemId,
    ]);
    expect(wiCheck.rows[0].status).not.toBe('failed');

    // 3. Agent assignment remains in pre-sweep state (not failed)
    const asgCheck = await pool.query(
      `SELECT office_state FROM agent_assignments WHERE work_item_id = $1`,
      [payload.workItemId],
    );
    expect(asgCheck.rows[0].office_state).not.toBe('failed');

    // 4. Work order remains in_progress (not failed)
    const woCheck = await pool.query(
      `SELECT status, failure_category FROM work_orders WHERE id = $1`,
      [payload.workOrderId],
    );
    expect(woCheck.rows[0].status).toBe('in_progress');
    expect(woCheck.rows[0].failure_category).toBeNull();

    // 5. Policy reservation remains unchanged at 0 (never negative)
    const polCheck = await pool.query(
      `SELECT reserved_spend_microunits FROM workspace_ai_policies WHERE workspace_id = $1`,
      [wsId],
    );
    expect(Number(polCheck.rows[0].reserved_spend_microunits)).toBe(0);

    // 6. No audit event inserted for this failure
    const auditCount = await pool.query(
      `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = 'artifact.failed'`,
      [payload.workItemId],
    );
    expect(Number(auditCount.rows[0].count)).toBe(0);
  });
});
