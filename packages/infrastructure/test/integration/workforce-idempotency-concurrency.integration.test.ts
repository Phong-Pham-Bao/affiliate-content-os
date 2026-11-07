import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { seedWorkforceBaseData, createTestKickoffParams } from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import { IdempotencyKeyReusedError } from '@affiliate-content-os/application';

describe('workforce-idempotency-concurrency.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let adapter: PostgresWorkforceAdapter;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    adapter = new PostgresWorkforceAdapter(pool);
    await seedWorkforceBaseData(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await context?.cleanup();
  });

  it('sequential identical replay returns cached=true without duplicating rows or audit', async () => {
    const key = 'seq-identical-test-key';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(key).digest());
    const reqHash = new Uint8Array(crypto.createHash('sha256').update('directive-one').digest());

    const params1 = createTestKickoffParams({ keyHash, requestHash: reqHash });
    const res1 = await adapter.kickoffWorkOrderAtomic(params1);
    expect(res1.cached).toBe(false);
    expect(res1.workOrder.id).toBe(params1.workOrder.id);

    // Replay with identical key and requestHash
    const params2 = createTestKickoffParams({ keyHash, requestHash: reqHash });
    const res2 = await adapter.kickoffWorkOrderAtomic(params2);
    expect(res2.cached).toBe(true);
    expect(res2.workOrder.id).toBe(res1.workOrder.id);

    // Verify row counts in real database did NOT duplicate
    const woRes = await pool.query(`SELECT id FROM work_orders WHERE id = $1`, [res1.workOrder.id]);
    expect(woRes.rows).toHaveLength(1);

    const cpRes = await pool.query(`SELECT id FROM context_packages WHERE id = $1`, [
      params1.contextPackage.id,
    ]);
    expect(cpRes.rows).toHaveLength(1);

    const auditRes = await pool.query(`SELECT id FROM audit_events WHERE resource_id = $1`, [
      res1.workOrder.id,
    ]);
    expect(auditRes.rows).toHaveLength(1);
  });

  it('sequential mismatched reuse rejects with IdempotencyKeyReusedError', async () => {
    const key = 'seq-mismatch-test-key';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(key).digest());
    const reqHashA = new Uint8Array(crypto.createHash('sha256').update('directive-a').digest());
    const reqHashB = new Uint8Array(crypto.createHash('sha256').update('directive-b').digest());

    const paramsA = createTestKickoffParams({ keyHash, requestHash: reqHashA });
    const resA = await adapter.kickoffWorkOrderAtomic(paramsA);
    expect(resA.cached).toBe(false);

    const paramsB = createTestKickoffParams({ keyHash, requestHash: reqHashB });
    await expect(adapter.kickoffWorkOrderAtomic(paramsB)).rejects.toThrow(
      IdempotencyKeyReusedError,
    );
  });

  it('concurrent identical kickoff serializes, returns cached=true for one, and creates exactly one graph', async () => {
    const key = 'concurrent-identical-test-key';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(key).digest());
    const reqHash = new Uint8Array(
      crypto.createHash('sha256').update('directive-concurrent').digest(),
    );

    const params = createTestKickoffParams({
      keyHash,
      requestHash: reqHash,
      directiveText: 'Concurrent directive for TikTok series',
    });

    const [res1, res2] = await Promise.all([
      adapter.kickoffWorkOrderAtomic(params),
      adapter.kickoffWorkOrderAtomic(params),
    ]);

    expect([res1.cached, res2.cached].sort()).toEqual([false, true]);
    expect(res1.workOrder.id).toBe(res2.workOrder.id);

    // Database has only 1 work order
    const woRes = await pool.query(`SELECT id FROM work_orders WHERE id = $1`, [res1.workOrder.id]);
    expect(woRes.rows).toHaveLength(1);

    // Database has only 1 audit event for this work order
    const auditRes = await pool.query(`SELECT id FROM audit_events WHERE resource_id = $1`, [
      res1.workOrder.id,
    ]);
    expect(auditRes.rows).toHaveLength(1);
  });
});
