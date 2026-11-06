import pg from 'pg';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@affiliate-content-os/infrastructure/database';
import type { UserId } from '@affiliate-content-os/domain';
import {
  IdempotencyKeyReusedError,
  SlugConflictError,
  createWorkspace,
  DefaultIdGenerator,
  SystemClock,
} from '@affiliate-content-os/application';
import {
  createPostgresTenancyAdapter,
  createPostgresIdempotencyAdapter,
} from '../../src/tenancy/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('workspace-creation-atomic.integration', () => {
  let context: TestDatabaseContext;
  let pool: pg.Pool;
  let database: ReturnType<typeof createDatabase>;
  let tenancyAdapter: ReturnType<typeof createPostgresTenancyAdapter>;
  let idempotencyAdapter: ReturnType<typeof createPostgresIdempotencyAdapter>;
  const clock = new SystemClock();
  const idGenerator = new DefaultIdGenerator();

  const testUserId = '0192b012-3456-789a-8bcd-ef0123456701' as UserId;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: context.dbUrl });
    database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 15000,
      sslMode: 'disable',
    });
    tenancyAdapter = createPostgresTenancyAdapter(database);
    idempotencyAdapter = createPostgresIdempotencyAdapter(database);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'google', 'sub-12345', 'user@example.com', 'Test User', 'active', NOW(), NOW(), 1)`,
      [testUserId],
    );
  });

  afterAll(async () => {
    await database?.close();
    await pool?.end();
    await context?.cleanup();
  });

  it('commits workspace, owner membership, idempotency record, and audit event atomically', async () => {
    const key = 'test-idemp-key-1';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const requestHash = crypto.createHash('sha256').update('req-body-1').digest();

    const result = await createWorkspace(
      {
        userId: testUserId,
        name: 'Atomic Workspace',
        slug: 'atomic-workspace',
        timezone: 'UTC',
        brandVoice: 'Friendly',
        defaultDisclosure: 'Affiliate link',
        aiEnabled: true,
        idempotency: { keyHash, requestHash },
        auditContext: {
          ipHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          userAgentSummary: 'IntegrationTest/1.0',
        },
      },
      {
        userDirectory: tenancyAdapter,
        workspacePersistence: tenancyAdapter,
        clock,
        idGenerator,
      },
    );

    expect(result.workspace.id).toBeDefined();
    expect(result.membership.role).toBe('owner');

    // Verify workspace in DB
    const wsRow = await pool.query(`SELECT * FROM workspaces WHERE id = $1`, [result.workspace.id]);
    expect(wsRow.rows).toHaveLength(1);
    expect(wsRow.rows[0].name).toBe('Atomic Workspace');

    // Verify membership in DB
    const memRow = await pool.query(
      `SELECT * FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
      [result.workspace.id, testUserId],
    );
    expect(memRow.rows).toHaveLength(1);
    expect(memRow.rows[0].role).toBe('owner');

    // Verify idempotency record in DB
    const idempRow = await pool.query(
      `SELECT * FROM idempotency_keys WHERE principal_id = $1 AND route_key = 'POST /api/v1/workspaces'`,
      [testUserId],
    );
    expect(idempRow.rows).toHaveLength(1);
    expect(idempRow.rows[0].status_code).toBe(201);
    expect(idempRow.rows[0].resource_id).toBe(result.workspace.id);

    // Verify audit event in DB
    const auditRow = await pool.query(
      `SELECT * FROM audit_events WHERE workspace_id = $1 AND action = 'workspace.created'`,
      [result.workspace.id],
    );
    expect(auditRow.rows).toHaveLength(1);
    expect(auditRow.rows[0].actor_user_id).toBe(testUserId);
    expect(auditRow.rows[0].result).toBe('succeeded');
    expect(auditRow.rows[0].changes_json).toMatchObject({
      status: { before: null, after: 'active' },
      name: { before: null, after: 'Atomic Workspace' },
    });

    // Verify Idempotency Store lookup
    const found = await idempotencyAdapter.findIdempotencyRecord({
      principalId: testUserId,
      routeKey: 'POST /api/v1/workspaces',
      keyHash,
    });
    expect(found).not.toBeNull();
    expect(found?.resourceId).toBe(result.workspace.id);
  });

  it('rolls back workspace, membership, idempotency, and audit event on slug conflict', async () => {
    const key = 'test-idemp-key-conflict';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const requestHash = crypto.createHash('sha256').update('req-body-conflict').digest();

    // First attempt creates atomic-workspace-2
    await createWorkspace(
      {
        userId: testUserId,
        name: 'Workspace 2',
        slug: 'atomic-workspace-2',
        timezone: 'UTC',
        idempotency: { keyHash, requestHash },
      },
      {
        userDirectory: tenancyAdapter,
        workspacePersistence: tenancyAdapter,
        clock,
        idGenerator,
      },
    );

    const key2 = 'test-idemp-key-conflict-2';
    const keyHash2 = crypto.createHash('sha256').update(key2).digest();

    // Second attempt with duplicate slug must fail with SlugConflictError
    await expect(
      createWorkspace(
        {
          userId: testUserId,
          name: 'Workspace 2 Duplicate',
          slug: 'atomic-workspace-2',
          timezone: 'UTC',
          idempotency: { keyHash: keyHash2, requestHash },
        },
        {
          userDirectory: tenancyAdapter,
          workspacePersistence: tenancyAdapter,
          clock,
          idGenerator,
        },
      ),
    ).rejects.toThrow(SlugConflictError);

    // Key2 must NOT be in DB because transaction rolled back completely
    const idempRow = await pool.query(`SELECT * FROM idempotency_keys WHERE key_hash = $1`, [
      Buffer.from(keyHash2),
    ]);
    expect(idempRow.rows).toHaveLength(0);
  });

  it('safely handles idempotency reuse: cached=true for identical request, IdempotencyKeyReusedError for different payload', async () => {
    const key = 'test-idemp-key-duplicate';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const requestHash = crypto.createHash('sha256').update('req-body-dup').digest();

    // First workspace creation
    const res1 = await createWorkspace(
      {
        userId: testUserId,
        name: 'Workspace 3',
        slug: 'atomic-workspace-3',
        timezone: 'UTC',
        idempotency: { keyHash, requestHash },
      },
      {
        userDirectory: tenancyAdapter,
        workspacePersistence: tenancyAdapter,
        clock,
        idGenerator,
      },
    );
    expect(res1.cached).toBe(false);
    expect(res1.auditEvent).not.toBeNull();
    expect(res1.auditEvent?.action).toBe('workspace.created');

    // Second workspace creation attempt with the same key and identical request payload returns cached=true
    const cachedRes = await createWorkspace(
      {
        userId: testUserId,
        name: 'Workspace 3',
        slug: 'atomic-workspace-3',
        timezone: 'UTC',
        idempotency: { keyHash, requestHash },
      },
      {
        userDirectory: tenancyAdapter,
        workspacePersistence: tenancyAdapter,
        clock,
        idGenerator,
      },
    );
    expect(cachedRes.cached).toBe(true);
    expect(cachedRes.auditEvent).toBeNull();
    expect(cachedRes.workspace.id).toBe(res1.workspace.id);

    // Third attempt with the same key but different request payload must fail with IdempotencyKeyReusedError
    const diffRequestHash = crypto.createHash('sha256').update('req-body-different').digest();
    await expect(
      createWorkspace(
        {
          userId: testUserId,
          name: 'Workspace 4',
          slug: 'atomic-workspace-4',
          timezone: 'UTC',
          idempotency: { keyHash, requestHash: diffRequestHash },
        },
        {
          userDirectory: tenancyAdapter,
          workspacePersistence: tenancyAdapter,
          clock,
          idGenerator,
        },
      ),
    ).rejects.toThrow(IdempotencyKeyReusedError);

    // Workspace 4 must not exist
    const ws4 = await pool.query(`SELECT * FROM workspaces WHERE slug = 'atomic-workspace-4'`);
    expect(ws4.rows).toHaveLength(0);
  });
});
