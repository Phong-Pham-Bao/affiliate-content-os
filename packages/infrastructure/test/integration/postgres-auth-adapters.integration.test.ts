import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/database/index.js';
import { createPostgresLoginTransactionAdapter } from '../../src/auth/postgres-login-transaction-adapter.js';
import { createPostgresSessionAdapter } from '../../src/auth/postgres-session-adapter.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL Auth Adapters Concurrency & Lifecycle Integration', () => {
  let context: TestDatabaseContext;
  let client: pg.Client;
  let database: Database;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    client = new pg.Client({ connectionString: context.dbUrl });
    await client.connect();

    database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 10,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (client) {
      await client.end();
    }
    if (context) {
      await context.cleanup();
    }
  });

  it('proves concurrent callback consumption allows exactly one winner and replays fail', async () => {
    const adapter = createPostgresLoginTransactionAdapter(database);
    const txId = '0192b012-3456-789a-8bcd-ef0123456801';
    const stateHash = new Uint8Array(32).fill(21);
    const browserBindingHash = new Uint8Array(32).fill(22);
    const cipher = new Uint8Array([10, 20, 30]);
    const iv = new Uint8Array(12).fill(23);
    const tag = new Uint8Array(16).fill(24);
    const now = '2026-11-02T12:00:00.000Z';
    const expires = '2026-11-02T12:10:00.000Z';

    await adapter.createLoginTransaction({
      id: txId,
      stateHash,
      browserBindingHash,
      secretsCiphertext: cipher,
      secretsIv: iv,
      secretsAuthTag: tag,
      keyVersion: 'v1',
      returnTo: '/welcome',
      createdAt: now,
      expiresAt: expires,
    });

    const criteria = {
      stateHash,
      browserBindingHash,
      now: '2026-11-02T12:02:00.000Z',
    };

    // Run two simultaneous consume operations
    const [res1, res2] = await Promise.all([
      adapter.consumeLoginTransaction(criteria),
      adapter.consumeLoginTransaction(criteria),
    ]);

    // Exactly one must be non-null and one null
    const winner = res1 !== null ? res1 : res2;
    const loser = res1 === null ? res1 : res2;

    expect(winner).not.toBeNull();
    expect(loser).toBeNull();
    expect(winner!.id).toBe(txId);
    expect(winner!.createdAt).toBe(now);
    expect(winner!.expiresAt).toBe(expires);
    expect(winner!.secretsCiphertext).toEqual(cipher);
    expect(winner!.secretsIv).toEqual(iv);
    expect(winner!.secretsAuthTag).toEqual(tag);

    // Replay returns null
    const replay = await adapter.consumeLoginTransaction(criteria);
    expect(replay).toBeNull();
  });

  it('proves concurrent session rotation allows exactly one winner', async () => {
    const sessionAdapter = createPostgresSessionAdapter(database);
    const userId = '0192b012-3456-789a-8bcd-ef0123456810';
    const now = new Date('2026-11-02T12:00:00.000Z');

    // Create user
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'https://test-issuer.example.com', 'user-rot-1', 'u@ex.com', 'User', 'active', $2, $2, 1);`,
      [userId, now],
    );

    const sessionId = '0192b012-3456-789a-8bcd-ef0123456820';
    const tokenHash = new Uint8Array(32).fill(31);
    const nowIso = now.toISOString();
    const idleExpires = '2026-11-02T12:30:00.000Z';
    const absExpires = '2026-11-02T20:00:00.000Z';

    await sessionAdapter.createSession({
      id: sessionId,
      userId,
      currentTokenHash: tokenHash,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      idleExpiresAt: idleExpires,
      absoluteExpiresAt: absExpires,
      rotatedAt: nowIso,
    });

    const newHash1 = new Uint8Array(32).fill(41);
    const newHash2 = new Uint8Array(32).fill(42);
    const rotatedAt = '2026-11-02T12:15:00.000Z';
    const graceUntil = '2026-11-02T12:15:30.000Z';

    // Two concurrent rotations with version=1
    const results = await Promise.allSettled([
      sessionAdapter.rotateSession({
        sessionId,
        currentVersion: 1,
        newCurrentHash: newHash1,
        oldCurrentHash: tokenHash,
        graceValidUntil: graceUntil,
        rotatedAt,
        lastSeenAt: rotatedAt,
        idleExpiresAt: idleExpires,
      }),
      sessionAdapter.rotateSession({
        sessionId,
        currentVersion: 1,
        newCurrentHash: newHash2,
        oldCurrentHash: tokenHash,
        graceValidUntil: graceUntil,
        rotatedAt,
        lastSeenAt: rotatedAt,
        idleExpiresAt: idleExpires,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Verify row version is exactly 2 and has previous token grace
    const candidate = await sessionAdapter.findCandidateSessions({
      tokenHash,
      now: '2026-11-02T12:15:10.000Z',
    });
    expect(candidate).toHaveLength(1);
    expect(candidate[0]!.version).toBe(2);
    expect(candidate[0]!.previousTokenHash).toEqual(tokenHash);
  });
});
