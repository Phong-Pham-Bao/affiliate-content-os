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

  it('expired reuse: reclaims expired idempotency row and allows fresh work order creation with different command', async () => {
    const key = 'expired-reclaim-test-key';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(key).digest());
    const reqHash1 = new Uint8Array(crypto.createHash('sha256').update('directive-first').digest());
    const reqHash2 = new Uint8Array(
      crypto.createHash('sha256').update('directive-second').digest(),
    );

    const params1 = createTestKickoffParams({
      keyHash,
      requestHash: reqHash1,
      directiveText: 'Original directive',
    });
    const res1 = await adapter.kickoffWorkOrderAtomic(params1);
    expect(res1.cached).toBe(false);

    // Manually expire the idempotency row in real PostgreSQL
    await pool.query(
      `UPDATE idempotency_keys
       SET expires_at = NOW() - INTERVAL '1 hour'
       WHERE workspace_id = $1 AND key_hash = $2`,
      [params1.workOrder.workspaceId, Buffer.from(keyHash)],
    );

    // Now execute fresh kickoff with same keyHash but new requestHash2 and new directiveText
    const params2 = createTestKickoffParams({
      keyHash,
      requestHash: reqHash2,
      directiveText: 'Reclaimed fresh directive',
    });
    const res2 = await adapter.kickoffWorkOrderAtomic(params2);

    expect(res2.cached).toBe(false);
    expect(res2.workOrder.id).toBe(params2.workOrder.id);
    expect(res2.workOrder.id).not.toBe(res1.workOrder.id);

    // Check that idempotency key row was replaced and is now live
    const idempCheck = await pool.query(
      `SELECT resource_id, expires_at > NOW() AS is_live
       FROM idempotency_keys
       WHERE workspace_id = $1 AND key_hash = $2`,
      [params2.workOrder.workspaceId, Buffer.from(keyHash)],
    );
    expect(idempCheck.rows).toHaveLength(1);
    expect(idempCheck.rows[0].resource_id).toBe(res2.workOrder.id);
    expect(idempCheck.rows[0].is_live).toBe(true);
  });

  it('concurrent conflicting kickoff: serializes, one succeeds and one throws IdempotencyKeyReusedError', async () => {
    const key = 'concurrent-conflicting-test-key';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(key).digest());
    const reqHashA = new Uint8Array(
      crypto.createHash('sha256').update('directive-payload-a').digest(),
    );
    const reqHashB = new Uint8Array(
      crypto.createHash('sha256').update('directive-payload-b').digest(),
    );

    const paramsA = createTestKickoffParams({
      keyHash,
      requestHash: reqHashA,
      directiveText: 'Directive A for conflict test',
    });
    const paramsB = createTestKickoffParams({
      keyHash,
      requestHash: reqHashB,
      directiveText: 'Directive B for conflict test',
    });

    const results = await Promise.allSettled([
      adapter.kickoffWorkOrderAtomic(paramsA),
      adapter.kickoffWorkOrderAtomic(paramsB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('authoritative database transaction timestamp decides expiry regardless of client clock skew', async () => {
    const key = 'clock-skew-expiry-test-key';
    const keyHash = new Uint8Array(crypto.createHash('sha256').update(key).digest());
    const reqHash1 = new Uint8Array(crypto.createHash('sha256').update('directive-one').digest());
    const reqHash2 = new Uint8Array(crypto.createHash('sha256').update('directive-two').digest());

    // 1. Initial kickoff creates live record
    const params1 = createTestKickoffParams({
      keyHash,
      requestHash: reqHash1,
      directiveText: 'Directive 1',
    });
    const res1 = await adapter.kickoffWorkOrderAtomic(params1);
    expect(res1.cached).toBe(false);

    // 2. Set expires_at in the past relative to database time (5 seconds ago)
    await pool.query(
      `UPDATE idempotency_keys
       SET expires_at = NOW() - INTERVAL '5 seconds'
       WHERE workspace_id = $1 AND key_hash = $2`,
      [params1.workOrder.workspaceId, Buffer.from(keyHash)],
    );

    // 3. Client clock is far in the future, but database transaction time is > expires_at
    const params2 = createTestKickoffParams({
      keyHash,
      requestHash: reqHash2,
      directiveText: 'Directive 2 after database expiry',
    });
    const res2 = await adapter.kickoffWorkOrderAtomic(params2);

    // Proven: Database time expired the row, so fresh work order is created
    expect(res2.cached).toBe(false);
    expect(res2.workOrder.id).toBe(params2.workOrder.id);
    expect(res2.workOrder.id).not.toBe(res1.workOrder.id);
  });
});
