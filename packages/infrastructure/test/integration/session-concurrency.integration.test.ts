import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticateApplicationSession,
  AuthenticationRequiredError,
} from '@affiliate-content-os/application';
import { createDatabase, type Database } from '../../src/database/index.js';
import { createAuthCryptoAdapter, createPostgresSessionAdapter } from '../../src/auth/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL Session Concurrency Integration', () => {
  let context: TestDatabaseContext;
  let client: pg.Client;
  let database: Database;

  const encryptionKey = Buffer.alloc(32, 0x44).toString('base64url');
  const keyVersion = 'v1';

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
    if (database) await database.close();
    if (client) await client.end();
    if (context) await context.cleanup();
  });

  it('proves concurrent requests on rotation serialize cleanly: one rotates, waiter authenticates via grace, zero conflicts', async () => {
    const crypto = createAuthCryptoAdapter(encryptionKey, keyVersion);
    const sessionStore = createPostgresSessionAdapter(database);

    const userId = '0192b012-3456-789a-8bcd-ef0123456830';
    const createdAt = new Date('2026-11-02T12:00:00.000Z');
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'https://test-issuer.example.com', 'user-conc-1', 'u1@ex.com', 'U1', 'active', $2, $2, 1);`,
      [userId, createdAt],
    );

    const sessionId = '0192b012-3456-789a-8bcd-ef0123456840';
    const rawToken = crypto.generateRandomToken();
    const tokenHash = crypto.hashToken(rawToken);

    // Initial session created 16 minutes in the past so rotation is due (> 15 min)
    const initRotatedAt = new Date('2026-11-02T12:00:00.000Z');
    const initIdleExpires = new Date('2026-11-02T12:30:00.000Z');
    const absExpires = new Date('2026-11-02T20:00:00.000Z');

    await sessionStore.createSession({
      id: sessionId,
      userId,
      currentTokenHash: tokenHash,
      createdAt: initRotatedAt.toISOString(),
      lastSeenAt: initRotatedAt.toISOString(),
      idleExpiresAt: initIdleExpires.toISOString(),
      absoluteExpiresAt: absExpires.toISOString(),
      rotatedAt: initRotatedAt.toISOString(),
    });

    const evalTime = new Date('2026-11-02T12:16:00.000Z');
    const deps = {
      crypto,
      sessionStore,
      now: () => evalTime,
      sessionIdleTtlSeconds: 1800,
      sessionRotationSeconds: 900,
      sessionRotationGraceSeconds: 30,
      sessionTouchIntervalSeconds: 300,
    };

    // Fire 2 concurrent requests with the current token
    const results = await Promise.allSettled([
      authenticateApplicationSession({ sessionCookie: rawToken }, deps),
      authenticateApplicationSession({ sessionCookie: rawToken }, deps),
    ]);

    // Both requests must be fulfilled without any concurrency conflict rejection
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('fulfilled');

    type AuthResult = Awaited<ReturnType<typeof authenticateApplicationSession>>;
    const auth1 = (results[0] as PromiseFulfilledResult<AuthResult>).value;
    const auth2 = (results[1] as PromiseFulfilledResult<AuthResult>).value;

    expect(auth1.session.id).toBe(sessionId);
    expect(auth2.session.id).toBe(sessionId);

    // Exactly one rotated and issued a new token, the other authenticated via grace
    const rotatedCount =
      (auth1.rotatedToken !== null ? 1 : 0) + (auth2.rotatedToken !== null ? 1 : 0);
    expect(rotatedCount).toBe(1);

    const winnerToken = auth1.rotatedToken ?? auth2.rotatedToken;
    expect(winnerToken).not.toBeNull();
  });

  it('proves old-token during grace and new-token schedules authenticate in both orders without conflict', async () => {
    const crypto = createAuthCryptoAdapter(encryptionKey, keyVersion);
    const sessionStore = createPostgresSessionAdapter(database);

    const userId = '0192b012-3456-789a-8bcd-ef0123456831';
    const createdAt = new Date('2026-11-02T12:00:00.000Z');
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'https://test-issuer.example.com', 'user-conc-2', 'u2@ex.com', 'U2', 'active', $2, $2, 1);`,
      [userId, createdAt],
    );

    const sessionId = '0192b012-3456-789a-8bcd-ef0123456841';
    const oldToken = crypto.generateRandomToken();
    const oldHash = crypto.hashToken(oldToken);

    await sessionStore.createSession({
      id: sessionId,
      userId,
      currentTokenHash: oldHash,
      createdAt: createdAt.toISOString(),
      lastSeenAt: createdAt.toISOString(),
      idleExpiresAt: new Date('2026-11-02T12:30:00.000Z').toISOString(),
      absoluteExpiresAt: new Date('2026-11-02T20:00:00.000Z').toISOString(),
      rotatedAt: createdAt.toISOString(),
    });

    // Step 1: Rotate to obtain newToken
    const rotTime = new Date('2026-11-02T12:16:00.000Z');
    const firstAuth = await authenticateApplicationSession(
      { sessionCookie: oldToken },
      {
        crypto,
        sessionStore,
        now: () => rotTime,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );
    const newToken = firstAuth.rotatedToken!;
    expect(newToken).toBeDefined();

    // Order A: Old token within grace, then new token
    const withinGraceTime = new Date('2026-11-02T12:16:15.000Z');
    const orderA1 = await authenticateApplicationSession(
      { sessionCookie: oldToken },
      {
        crypto,
        sessionStore,
        now: () => withinGraceTime,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );
    expect(orderA1.session.id).toBe(sessionId);
    expect(orderA1.rotatedToken).toBeNull();

    const orderA2 = await authenticateApplicationSession(
      { sessionCookie: newToken },
      {
        crypto,
        sessionStore,
        now: () => withinGraceTime,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );
    expect(orderA2.session.id).toBe(sessionId);
    expect(orderA2.rotatedToken).toBeNull();

    // Order B: New token first, then old token within grace
    const orderB1 = await authenticateApplicationSession(
      { sessionCookie: newToken },
      {
        crypto,
        sessionStore,
        now: () => withinGraceTime,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );
    expect(orderB1.session.id).toBe(sessionId);

    const orderB2 = await authenticateApplicationSession(
      { sessionCookie: oldToken },
      {
        crypto,
        sessionStore,
        now: () => withinGraceTime,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );
    expect(orderB2.session.id).toBe(sessionId);
    expect(orderB2.rotatedToken).toBeNull();
  });

  it('proves concurrent requests with old-token and new-token succeed in both forced orders and enforces exact before, at, and after grace boundaries', async () => {
    const crypto = createAuthCryptoAdapter(encryptionKey, keyVersion);
    const sessionStore = createPostgresSessionAdapter(database);

    const userId = '0192b012-3456-789a-8bcd-ef0123456832';
    const createdAt = new Date('2026-11-02T12:00:00.000Z');
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'https://test-issuer.example.com', 'user-conc-grace', 'grace@ex.com', 'Grace User', 'active', $2, $2, 1);`,
      [userId, createdAt],
    );

    const sessionId = '0192b012-3456-789a-8bcd-ef0123456842';
    const oldToken = crypto.generateRandomToken();
    const oldHash = crypto.hashToken(oldToken);

    await sessionStore.createSession({
      id: sessionId,
      userId,
      currentTokenHash: oldHash,
      createdAt: createdAt.toISOString(),
      lastSeenAt: createdAt.toISOString(),
      idleExpiresAt: new Date('2026-11-02T12:30:00.000Z').toISOString(),
      absoluteExpiresAt: new Date('2026-11-02T20:00:00.000Z').toISOString(),
      rotatedAt: createdAt.toISOString(),
    });

    // Rotate at 12:16:00
    const rotTime = new Date('2026-11-02T12:16:00.000Z');
    const rotResult = await authenticateApplicationSession(
      { sessionCookie: oldToken },
      {
        crypto,
        sessionStore,
        now: () => rotTime,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );
    const newToken = rotResult.rotatedToken!;
    expect(newToken).toBeDefined();

    // Forced concurrent Schedule A: Old token during grace and new token concurrently
    const schedATime = new Date('2026-11-02T12:16:10.000Z');
    const [resA_old, resA_new] = await Promise.all([
      authenticateApplicationSession(
        { sessionCookie: oldToken },
        {
          crypto,
          sessionStore,
          now: () => schedATime,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
      authenticateApplicationSession(
        { sessionCookie: newToken },
        {
          crypto,
          sessionStore,
          now: () => schedATime,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ]);
    expect(resA_old.session.id).toBe(sessionId);
    expect(resA_new.session.id).toBe(sessionId);

    // Forced concurrent Schedule B: New token and old token during grace concurrently
    const schedBTime = new Date('2026-11-02T12:16:15.000Z');
    const [resB_new, resB_old] = await Promise.all([
      authenticateApplicationSession(
        { sessionCookie: newToken },
        {
          crypto,
          sessionStore,
          now: () => schedBTime,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
      authenticateApplicationSession(
        { sessionCookie: oldToken },
        {
          crypto,
          sessionStore,
          now: () => schedBTime,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ]);
    expect(resB_new.session.id).toBe(sessionId);
    expect(resB_old.session.id).toBe(sessionId);

    // Exact grace boundary: graceValidUntil is 2026-11-02T12:16:30.000Z
    // 1. Exactly before grace (12:16:29.999Z): valid
    const beforeGrace = new Date('2026-11-02T12:16:29.999Z');
    const authBefore = await authenticateApplicationSession(
      { sessionCookie: oldToken },
      {
        crypto,
        sessionStore,
        now: () => beforeGrace,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );
    expect(authBefore.session.id).toBe(sessionId);

    // 2. Exactly at grace boundary (12:16:30.000Z): valid (>= $2)
    const atGrace = new Date('2026-11-02T12:16:30.000Z');
    const authAt = await authenticateApplicationSession(
      { sessionCookie: oldToken },
      {
        crypto,
        sessionStore,
        now: () => atGrace,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );
    expect(authAt.session.id).toBe(sessionId);

    // 3. Exactly after grace (12:16:30.001Z): expired -> AuthenticationRequiredError
    const afterGrace = new Date('2026-11-02T12:16:30.001Z');
    await expect(
      authenticateApplicationSession(
        { sessionCookie: oldToken },
        {
          crypto,
          sessionStore,
          now: () => afterGrace,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ).rejects.toThrow(AuthenticationRequiredError);
  });

  it('proves session authentication, rotation, touch, inactive user revocation, and concurrency work with poolMax=1 without starvation', async () => {
    const singleConnDb = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 1,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });

    try {
      const crypto = createAuthCryptoAdapter(encryptionKey, keyVersion);
      const sessionStore = createPostgresSessionAdapter(singleConnDb);

      const userId = '0192b012-3456-789a-8bcd-ef0123456833';
      const createdAt = new Date('2026-11-02T12:00:00.000Z');
      await client.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ($1, 'https://test-issuer.example.com', 'user-poolmax-1', 'pool1@ex.com', 'Pool1 User', 'active', $2, $2, 1);`,
        [userId, createdAt],
      );

      const sessionId = '0192b012-3456-789a-8bcd-ef0123456843';
      const token = crypto.generateRandomToken();
      const tokenHash = crypto.hashToken(token);

      await sessionStore.createSession({
        id: sessionId,
        userId,
        currentTokenHash: tokenHash,
        createdAt: createdAt.toISOString(),
        lastSeenAt: createdAt.toISOString(),
        idleExpiresAt: new Date('2026-11-02T12:30:00.000Z').toISOString(),
        absoluteExpiresAt: new Date('2026-11-02T20:00:00.000Z').toISOString(),
        rotatedAt: createdAt.toISOString(),
      });

      // 1. Authenticate with poolMax: 1 (exercises transaction + user lookup on same connection)
      const auth1 = await authenticateApplicationSession(
        { sessionCookie: token },
        {
          crypto,
          sessionStore,
          now: () => new Date('2026-11-02T12:01:00.000Z'),
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      );
      expect(auth1.session.id).toBe(sessionId);
      expect(auth1.user.id).toBe(userId);
      expect(auth1.rotatedToken).toBeNull();

      // 2. Touch with poolMax: 1 (> 300s touch interval)
      const auth2 = await authenticateApplicationSession(
        { sessionCookie: token },
        {
          crypto,
          sessionStore,
          now: () => new Date('2026-11-02T12:07:00.000Z'),
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      );
      expect(auth2.session.id).toBe(sessionId);
      expect(auth2.rotatedToken).toBeNull();

      // 3. Rotate with poolMax: 1 (> 900s rotation interval)
      const auth3 = await authenticateApplicationSession(
        { sessionCookie: token },
        {
          crypto,
          sessionStore,
          now: () => new Date('2026-11-02T12:16:00.000Z'),
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      );
      expect(auth3.session.id).toBe(sessionId);
      const rotatedToken = auth3.rotatedToken;
      expect(rotatedToken).not.toBeNull();

      // 4. Concurrent current and previous token auth with poolMax: 1
      const [concPrev, concCurr] = await Promise.all([
        authenticateApplicationSession(
          { sessionCookie: token },
          {
            crypto,
            sessionStore,
            now: () => new Date('2026-11-02T12:16:10.000Z'),
            sessionIdleTtlSeconds: 1800,
            sessionRotationSeconds: 900,
            sessionRotationGraceSeconds: 30,
            sessionTouchIntervalSeconds: 300,
          },
        ),
        authenticateApplicationSession(
          { sessionCookie: rotatedToken! },
          {
            crypto,
            sessionStore,
            now: () => new Date('2026-11-02T12:16:10.000Z'),
            sessionIdleTtlSeconds: 1800,
            sessionRotationSeconds: 900,
            sessionRotationGraceSeconds: 30,
            sessionTouchIntervalSeconds: 300,
          },
        ),
      ]);
      expect(concPrev.session.id).toBe(sessionId);
      expect(concCurr.session.id).toBe(sessionId);

      // 5. Inactive user revocation with poolMax: 1
      await client.query(`UPDATE users SET status = 'disabled' WHERE id = $1;`, [userId]);
      await expect(
        authenticateApplicationSession(
          { sessionCookie: rotatedToken! },
          {
            crypto,
            sessionStore,
            now: () => new Date('2026-11-02T12:16:20.000Z'),
            sessionIdleTtlSeconds: 1800,
            sessionRotationSeconds: 900,
            sessionRotationGraceSeconds: 30,
            sessionTouchIntervalSeconds: 300,
          },
        ),
      ).rejects.toThrow(AuthenticationRequiredError);

      // Confirm session in DB was revoked with reason 'user_unavailable'
      const sessRow = await client.query<{
        revoked_at: Date | null;
        revocation_reason: string | null;
      }>(`SELECT revoked_at, revocation_reason FROM application_sessions WHERE id = $1;`, [
        sessionId,
      ]);
      expect(sessRow.rows[0]?.revoked_at).not.toBeNull();
      expect(sessRow.rows[0]?.revocation_reason).toBe('user_unavailable');
    } finally {
      await singleConnDb.close();
    }
  });
});
