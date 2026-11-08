import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';
import { seedWorkforceBaseData, createTestKickoffParams } from './helpers/workforce-fixtures.js';
import { PostgresWorkforceAdapter } from '../../src/workforce/postgres-workforce-adapter.js';
import {
  IdempotencyKeyReusedError,
  type KickoffWorkOrderAtomicParams,
} from '@affiliate-content-os/application';
import { parseIsoTimestamp } from '@affiliate-content-os/domain';

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
       SET created_at = NOW() - INTERVAL '2 hours',
           expires_at = NOW() - INTERVAL '1 hour'
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
    const reqHash3 = new Uint8Array(crypto.createHash('sha256').update('directive-three').digest());

    // 1. Initial kickoff creates live record
    const params1 = createTestKickoffParams({
      keyHash,
      requestHash: reqHash1,
      directiveText: 'Directive 1',
    });
    const res1 = await adapter.kickoffWorkOrderAtomic(params1);
    expect(res1.cached).toBe(false);

    // 2. Set created_at and expires_at in the past relative to database time so created_at < expires_at < NOW()
    await pool.query(
      `UPDATE idempotency_keys
       SET created_at = NOW() - INTERVAL '10 seconds',
           expires_at = NOW() - INTERVAL '5 seconds'
       WHERE workspace_id = $1 AND key_hash = $2`,
      [params1.workOrder.workspaceId, Buffer.from(keyHash)],
    );

    // 3. Client clock is far in the past (e.g. 1999), but database transaction time is > expires_at (NOW() > NOW() - 5s).
    // If the transaction evaluated client-skewed createdAt against expires_at, it would falsely treat the key
    // as still active (1999 < expires_at) and reject with IdempotencyKeyReusedError due to different request hash.
    // Instead, authoritative PostgreSQL transaction_timestamp() reclaims the expired record and executes kickoff.
    const baseParams2 = createTestKickoffParams({
      keyHash,
      requestHash: reqHash2,
      directiveText: 'Directive 2 after database expiry',
    });
    const params2: KickoffWorkOrderAtomicParams = {
      ...baseParams2,
      idempotency: {
        ...baseParams2.idempotency,
        createdAt: parseIsoTimestamp('1999-01-01T00:00:00.000Z'),
      },
    };
    const res2 = await adapter.kickoffWorkOrderAtomic(params2);

    expect(res2.cached).toBe(false);
    expect(res2.workOrder.id).toBe(params2.workOrder.id);
    expect(res2.workOrder.id).not.toBe(res1.workOrder.id);

    // 4. Now test the converse: client clock is far in the future (e.g. 2099), but database record is LIVE.
    // The key was just recreated by params2 with 24-hour expiry in PostgreSQL time.
    // If the transaction evaluated client-skewed createdAt against expires_at, it would falsely treat the key
    // as already expired (2099 > expires_at) and allow conflicting reuse.
    // Instead, authoritative PostgreSQL transaction_timestamp() knows the key is still live and rejects with IdempotencyKeyReusedError.
    const baseParams3 = createTestKickoffParams({
      keyHash,
      requestHash: reqHash3,
      directiveText: 'Directive 3 with conflicting payload and far-future clock',
    });
    const params3: KickoffWorkOrderAtomicParams = {
      ...baseParams3,
      idempotency: {
        ...baseParams3.idempotency,
        createdAt: parseIsoTimestamp('2099-01-01T00:00:00.000Z'),
      },
    };
    await expect(adapter.kickoffWorkOrderAtomic(params3)).rejects.toThrow(
      IdempotencyKeyReusedError,
    );

    // 5. Far-future matching replay still returns cached=true without prematurely expiring or duplicating
    const baseParamsReplay = createTestKickoffParams({
      keyHash,
      requestHash: reqHash2,
      directiveText: 'Directive 2 after database expiry',
    });
    const paramsReplay: KickoffWorkOrderAtomicParams = {
      ...baseParamsReplay,
      idempotency: {
        ...baseParamsReplay.idempotency,
        createdAt: parseIsoTimestamp('2099-01-01T00:00:00.000Z'),
      },
    };
    const resReplay = await adapter.kickoffWorkOrderAtomic(paramsReplay);
    expect(resReplay.cached).toBe(true);
    expect(resReplay.workOrder.id).toBe(res2.workOrder.id);
  });
});
