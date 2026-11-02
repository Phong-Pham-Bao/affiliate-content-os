import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseIsoTimestamp, parseUserId, type UserSnapshot } from '@affiliate-content-os/domain';
import {
  DefaultIdGenerator,
  IdentityUnavailableError,
  resolveVerifiedIdentity,
  SystemClock,
} from '@affiliate-content-os/application';
import { createDatabase } from '../../src/database/index.js';
import { createPostgresTenancyAdapter } from '../../src/tenancy/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL Identity Adapter & Concurrency Integration Suite', () => {
  let context: TestDatabaseContext;
  let client: pg.Client;
  const nowIso = '2026-11-01T12:00:00.000Z';
  const now = parseIsoTimestamp(nowIso);

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    client = new pg.Client({ connectionString: context.dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
    if (context) {
      await context.cleanup();
    }
  });

  it('provisions missing identity and resolves by exact provider/subject', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);

    const userId = parseUserId('0192c012-3456-789a-8bcd-ef0123456001');
    const user: UserSnapshot = Object.freeze({
      id: userId,
      identityProvider: 'https://issuer.corp.example.com',
      identitySubject: 'subject-alpha-001',
      email: 'alpha001@corp.example.com',
      displayName: 'Alpha One',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const inserted = await adapter.insertUserIfAbsent({ user });
    expect(inserted).not.toBeNull();
    expect(inserted!.id).toBe(userId);
    expect(inserted!.status).toBe('active');
    expect(inserted!.version).toBe(1);
    expect(inserted!.createdAt).toBe(nowIso);
    expect(inserted!.updatedAt).toBe(nowIso);

    // Verify lookup by exact provider and subject
    const lookupResults = await adapter.findUsersByIdentity({
      identityProvider: 'https://issuer.corp.example.com',
      identitySubject: 'subject-alpha-001',
    });

    expect(lookupResults).toHaveLength(1);
    expect(lookupResults[0]!.id).toBe(userId);
    expect(lookupResults[0]!.email).toBe('alpha001@corp.example.com');
    expect(lookupResults[0]!.displayName).toBe('Alpha One');

    await database.close();
  });

  it('email is independent: lookup and uniqueness ignore email, and different email returns existing row unchanged', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);

    const userId = parseUserId('0192c012-3456-789a-8bcd-ef0123456002');
    const user: UserSnapshot = Object.freeze({
      id: userId,
      identityProvider: 'https://issuer.corp.example.com',
      identitySubject: 'subject-beta-002',
      email: 'original@example.com',
      displayName: 'Beta Two',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    await adapter.insertUserIfAbsent({ user });

    // Resolving via application with a different email returns original user unmodified
    const principal = await resolveVerifiedIdentity(
      {
        claims: {
          identityProvider: 'https://issuer.corp.example.com',
          identitySubject: 'subject-beta-002',
          email: 'changed-email@example.com',
          displayName: 'Different Name',
        },
      },
      {
        identityDirectory: adapter,
        clock: new SystemClock(),
        idGenerator: new DefaultIdGenerator(),
      },
    );

    expect(principal.user.id).toBe(userId);
    expect(principal.user.email).toBe('original@example.com'); // Unchanged
    expect(principal.user.displayName).toBe('Beta Two'); // Unchanged

    // Duplicate email across different provider/subject succeeds (email has no uniqueness constraint)
    const anotherUser: UserSnapshot = Object.freeze({
      id: parseUserId('0192c012-3456-789a-8bcd-ef0123456003'),
      identityProvider: 'https://issuer.corp.example.com',
      identitySubject: 'subject-gamma-003',
      email: 'original@example.com', // same email
      displayName: 'Gamma Three',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const insertedAnother = await adapter.insertUserIfAbsent({ user: anotherUser });
    expect(insertedAnother).not.toBeNull();
    expect(insertedAnother!.id).toBe('0192c012-3456-789a-8bcd-ef0123456003');

    await database.close();
  });

  it('creates two distinct users for the same subject across two different providers', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);

    const userP1: UserSnapshot = Object.freeze({
      id: parseUserId('0192c012-3456-789a-8bcd-ef0123456004'),
      identityProvider: 'https://provider-one.example.com',
      identitySubject: 'shared-subject-id',
      email: 'user@example.com',
      displayName: 'User P1',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const userP2: UserSnapshot = Object.freeze({
      id: parseUserId('0192c012-3456-789a-8bcd-ef0123456005'),
      identityProvider: 'https://provider-two.example.com',
      identitySubject: 'shared-subject-id',
      email: 'user@example.com',
      displayName: 'User P2',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const ins1 = await adapter.insertUserIfAbsent({ user: userP1 });
    const ins2 = await adapter.insertUserIfAbsent({ user: userP2 });

    expect(ins1).not.toBeNull();
    expect(ins2).not.toBeNull();
    expect(ins1!.id).not.toBe(ins2!.id);

    const res1 = await adapter.findUsersByIdentity({
      identityProvider: 'https://provider-one.example.com',
      identitySubject: 'shared-subject-id',
    });
    const res2 = await adapter.findUsersByIdentity({
      identityProvider: 'https://provider-two.example.com',
      identitySubject: 'shared-subject-id',
    });

    expect(res1).toHaveLength(1);
    expect(res2).toHaveLength(1);
    expect(res1[0]!.id).toBe('0192c012-3456-789a-8bcd-ef0123456004');
    expect(res2[0]!.id).toBe('0192c012-3456-789a-8bcd-ef0123456005');

    await database.close();
  });

  it('concurrent initial provisions: one wins insert, one recovers via ON CONFLICT DO NOTHING with zero duplicates', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);

    const claims = {
      identityProvider: 'https://issuer.concurrency.example.com',
      identitySubject: 'concurrent-sub-999',
      email: 'concurrent@example.com',
      displayName: 'Concurrent User',
    };

    // Run two simultaneous resolveVerifiedIdentity calls
    const [p1, p2] = await Promise.all([
      resolveVerifiedIdentity(
        { claims },
        {
          identityDirectory: adapter,
          clock: new SystemClock(),
          idGenerator: new DefaultIdGenerator(),
        },
      ),
      resolveVerifiedIdentity(
        { claims },
        {
          identityDirectory: adapter,
          clock: new SystemClock(),
          idGenerator: new DefaultIdGenerator(),
        },
      ),
    ]);

    expect(p1.user.id).toBe(p2.user.id);
    expect(p1.user.identityProvider).toBe('https://issuer.concurrency.example.com');
    expect(p1.user.identitySubject).toBe('concurrent-sub-999');

    // Verify exactly one row in PostgreSQL
    const dbCount = await client.query(
      `SELECT count(*) FROM users WHERE identity_provider = $1 AND identity_subject = $2`,
      ['https://issuer.concurrency.example.com', 'concurrent-sub-999'],
    );
    expect(Number(dbCount.rows[0]!.count)).toBe(1);

    await database.close();
  });

  it('fails closed with IdentityUnavailableError for disabled and deletion_pending users without reactivation', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);

    const disabledId = '0192c012-3456-789a-8bcd-ef0123456006';
    const deletionId = '0192c012-3456-789a-8bcd-ef0123456007';

    // Seed directly in DB
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'https://inactive.example.com', 'sub-disabled', 'dis@example.com', 'Dis', 'disabled', $3, $3, 1),
              ($2, 'https://inactive.example.com', 'sub-deletion', 'del@example.com', 'Del', 'deletion_pending', $3, $3, 1);`,
      [disabledId, deletionId, nowIso],
    );

    // Disabled resolution
    await expect(
      resolveVerifiedIdentity(
        {
          claims: {
            identityProvider: 'https://inactive.example.com',
            identitySubject: 'sub-disabled',
          },
        },
        {
          identityDirectory: adapter,
          clock: new SystemClock(),
          idGenerator: new DefaultIdGenerator(),
        },
      ),
    ).rejects.toThrow(IdentityUnavailableError);

    // Deletion pending resolution
    await expect(
      resolveVerifiedIdentity(
        {
          claims: {
            identityProvider: 'https://inactive.example.com',
            identitySubject: 'sub-deletion',
          },
        },
        {
          identityDirectory: adapter,
          clock: new SystemClock(),
          idGenerator: new DefaultIdGenerator(),
        },
      ),
    ).rejects.toThrow(IdentityUnavailableError);

    // Verify statuses in DB were NOT reactivated or modified
    const checkDisabled = await client.query('SELECT status FROM users WHERE id = $1', [
      disabledId,
    ]);
    expect(checkDisabled.rows[0]!.status).toBe('disabled');

    const checkDeletion = await client.query('SELECT status FROM users WHERE id = $1', [
      deletionId,
    ]);
    expect(checkDeletion.rows[0]!.status).toBe('deletion_pending');

    await database.close();
  });

  it('proves relation set remains strictly unchanged (schema_migrations, users, workspaces, workspace_memberships)', async () => {
    const res = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name;`,
    );

    const tables = res.rows.map((r) => r.table_name);
    expect(tables).toEqual(['schema_migrations', 'users', 'workspace_memberships', 'workspaces']);
  });
});
