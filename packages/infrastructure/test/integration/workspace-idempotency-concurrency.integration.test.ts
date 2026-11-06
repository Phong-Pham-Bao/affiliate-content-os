import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  DefaultIdGenerator,
  IdempotencyKeyReusedError,
  SlugConflictError,
  SystemClock,
} from '@affiliate-content-os/application';
import { parseUserId } from '@affiliate-content-os/domain';
import { createDatabase, type Database } from '../../src/database/index.js';
import {
  createPostgresIdempotencyAdapter,
  createPostgresTenancyAdapter,
} from '../../src/tenancy/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL Workspace Idempotency Concurrency Integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let database: Database;
  let tenancyAdapter: ReturnType<typeof createPostgresTenancyAdapter>;
  const clock = new SystemClock();
  const idGenerator = new DefaultIdGenerator();

  const testUserId = parseUserId('0192b012-3456-789a-8bcd-ef0123456701');
  const getDeps = () => ({
    userDirectory: tenancyAdapter,
    workspacePersistence: tenancyAdapter,
    clock,
    idGenerator,
  });

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 10,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 15000,
      sslMode: 'disable',
    });
    tenancyAdapter = createPostgresTenancyAdapter(database);
    createPostgresIdempotencyAdapter(database);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-idemp-123', 'idemp@example.com', 'Idemp User', 'active', NOW(), NOW(), 1)`,
      [testUserId],
    );
  });

  afterAll(async () => {
    await database?.close();
    await pool?.end();
    await context?.cleanup();
  });

  it('identical concurrency: serializes requests, returns cached=true for second, creates exactly one workspace', async () => {
    const key = 'idemp-key-identical-concurrency';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const requestHash = crypto.createHash('sha256').update('body-identical').digest();

    const makeCommand = (slug: string) => ({
      userId: testUserId,
      name: 'Concurrent WS',
      slug,
      timezone: 'UTC',
      idempotency: { keyHash, requestHash },
    });

    const [res1, res2] = await Promise.all([
      createWorkspace(makeCommand('concurrent-ws-1'), getDeps()),
      createWorkspace(makeCommand('concurrent-ws-1'), getDeps()),
    ]);

    expect([res1.cached, res2.cached].sort()).toEqual([false, true]);
    const freshRes = res1.cached ? res2 : res1;
    const cachedRes = res1.cached ? res1 : res2;

    expect(freshRes.cached).toBe(false);
    expect(freshRes.auditEvent).not.toBeNull();
    expect(freshRes.auditEvent?.action).toBe('workspace.created');

    expect(cachedRes.cached).toBe(true);
    expect(cachedRes.auditEvent).toBeNull();

    expect(res1.workspace.id).toBe(res2.workspace.id);
    expect(res1.membership.id).toBe(res2.membership.id);

    const wsRows = await pool.query(`SELECT id FROM workspaces WHERE slug = 'concurrent-ws-1'`);
    expect(wsRows.rows).toHaveLength(1);

    const memRows = await pool.query(
      `SELECT id FROM workspace_memberships WHERE workspace_id = $1`,
      [res1.workspace.id],
    );
    expect(memRows.rows).toHaveLength(1);

    const idempRows = await pool.query(`SELECT id FROM idempotency_keys WHERE key_hash = $1`, [
      Buffer.from(keyHash),
    ]);
    expect(idempRows.rows).toHaveLength(1);

    const auditRows = await pool.query(
      `SELECT id, action FROM audit_events WHERE workspace_id = $1 AND action = 'workspace.created'`,
      [res1.workspace.id],
    );
    expect(auditRows.rows).toHaveLength(1);
  });

  it('mismatched concurrency: one succeeds and the other rejects with IdempotencyKeyReusedError', async () => {
    const key = 'idemp-key-mismatched-concurrency';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const reqHashA = crypto.createHash('sha256').update('body-a').digest();
    const reqHashB = crypto.createHash('sha256').update('body-b').digest();

    const results = await Promise.allSettled([
      createWorkspace(
        {
          userId: testUserId,
          name: 'WS Mismatch A',
          slug: 'ws-mismatch-a',
          timezone: 'UTC',
          idempotency: { keyHash, requestHash: reqHashA },
        },
        getDeps(),
      ),
      createWorkspace(
        {
          userId: testUserId,
          name: 'WS Mismatch B',
          slug: 'ws-mismatch-b',
          timezone: 'UTC',
          idempotency: { keyHash, requestHash: reqHashB },
        },
        getDeps(),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('expired reuse: reclaims expired idempotency row and allows workspace creation', async () => {
    const key = 'idemp-key-expired-reuse';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const requestHash = crypto.createHash('sha256').update('body-expired-1').digest();

    const initial = await createWorkspace(
      {
        userId: testUserId,
        name: 'Initial WS',
        slug: 'initial-ws',
        timezone: 'UTC',
        idempotency: { keyHash, requestHash },
      },
      getDeps(),
    );
    expect(initial.cached).toBe(false);

    await pool.query(
      `UPDATE idempotency_keys
       SET created_at = NOW() - INTERVAL '3 hours',
           expires_at = NOW() - INTERVAL '2 hours'
       WHERE key_hash = $1`,
      [Buffer.from(keyHash)],
    );

    const newReqHash = crypto.createHash('sha256').update('body-expired-reused').digest();
    const recreated = await createWorkspace(
      {
        userId: testUserId,
        name: 'Recreated WS',
        slug: 'recreated-ws',
        timezone: 'UTC',
        idempotency: { keyHash, requestHash: newReqHash },
      },
      getDeps(),
    );

    expect(recreated.cached).toBe(false);
    expect(recreated.workspace.id).not.toBe(initial.workspace.id);

    const idempRows = await pool.query(
      `SELECT resource_id, expires_at > NOW() AS is_live FROM idempotency_keys WHERE key_hash = $1`,
      [Buffer.from(keyHash)],
    );
    expect(idempRows.rows).toHaveLength(1);
    expect(idempRows.rows[0].resource_id).toBe(recreated.workspace.id);
    expect(idempRows.rows[0].is_live).toBe(true);
  });

  it('rollback: slug conflict aborts transaction, rolls back idempotency record, and allows subsequent reuse', async () => {
    const key = 'idemp-key-rollback';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const requestHash = crypto.createHash('sha256').update('body-rollback').digest();

    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, ai_enabled, status, created_at, updated_at, version)
       VALUES ('0192b012-3456-789a-8bcd-ef0123456799', 'Existing Slug WS', 'conflict-slug', 'UTC', false, 'active', NOW(), NOW(), 1)`,
    );

    await expect(
      createWorkspace(
        {
          userId: testUserId,
          name: 'Conflict WS',
          slug: 'conflict-slug',
          timezone: 'UTC',
          idempotency: { keyHash, requestHash },
        },
        getDeps(),
      ),
    ).rejects.toThrow(SlugConflictError);

    const idempCheck = await pool.query(`SELECT id FROM idempotency_keys WHERE key_hash = $1`, [
      Buffer.from(keyHash),
    ]);
    expect(idempCheck.rows).toHaveLength(0);

    const successResult = await createWorkspace(
      {
        userId: testUserId,
        name: 'Clean WS',
        slug: 'clean-slug-after-rollback',
        timezone: 'UTC',
        idempotency: { keyHash, requestHash },
      },
      getDeps(),
    );
    expect(successResult.cached).toBe(false);
    expect(successResult.workspace.slug).toBe('clean-slug-after-rollback');
  });
});
