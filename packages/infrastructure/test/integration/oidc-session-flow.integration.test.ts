import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticateApplicationSession,
  beginOidcLogin,
  completeOidcLogin,
  getCurrentUser,
  logoutApplicationSession,
  AuthenticationRequiredError,
  DefaultIdGenerator,
  SystemClock,
} from '@affiliate-content-os/application';
import { isValidUuidV7 } from '@affiliate-content-os/domain';
import { createDatabase, type Database } from '../../src/database/index.js';
import {
  createAuthCryptoAdapter,
  createPostgresLoginTransactionAdapter,
  createPostgresSessionAdapter,
  createPostgresWorkspaceSummaryAdapter,
  discoverOidcAdapter,
} from '../../src/auth/index.js';
import { createPostgresTenancyAdapter } from '../../src/tenancy/index.js';
import { createTestOidcIssuer, type TestOidcIssuer } from '../helpers/test-oidc-issuer.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL & Local OIDC End-to-End Integration Flow', () => {
  let context: TestDatabaseContext;
  let client: pg.Client;
  let database: Database;
  let issuer: TestOidcIssuer;

  const clientId = 'integration-client-id';
  const clientSecret = 'integration-client-secret';
  const redirectUri = 'http://127.0.0.1:3001/auth/callback';
  const encryptionKey = Buffer.alloc(32, 0x42).toString('base64url');
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

    issuer = await createTestOidcIssuer(clientId, clientSecret);
  });

  afterAll(async () => {
    if (issuer) await issuer.close();
    if (database) await database.close();
    if (client) await client.end();
    if (context) await context.cleanup();
  });

  it('proves full login start, callback exchange, session authentication, me, and logout lifecycle', async () => {
    const oidcAdapter = await discoverOidcAdapter({
      issuer: issuer.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });

    const crypto = createAuthCryptoAdapter(encryptionKey, keyVersion);
    const txStore = createPostgresLoginTransactionAdapter(database);
    const sessionStore = createPostgresSessionAdapter(database);
    const tenancyAdapter = createPostgresTenancyAdapter(database);
    const workspaceSummary = createPostgresWorkspaceSummaryAdapter(database);
    const clock = new SystemClock();
    const idGenerator = new DefaultIdGenerator();

    const now = new Date('2026-11-02T12:00:00.000Z');

    // 1. Begin Login
    const startResult = await beginOidcLogin(
      { returnTo: '/dashboard/campaigns' },
      {
        crypto,
        transactionStore: txStore,
        oidc: oidcAdapter,
        generateId: () => idGenerator.generateId(),
        now: () => now,
        transactionTtlSeconds: 600,
      },
    );

    expect(startResult.authorizationUrl).toContain('/authorize?');
    expect(startResult.transactionCookieValue).toBeDefined();

    // Verify transaction was persisted with UUIDv7
    const txDbRes = await client.query<{ id: string }>(
      `SELECT id FROM oidc_login_transactions WHERE status = 'pending'`,
    );
    expect(txDbRes.rowCount).toBe(1);
    expect(isValidUuidV7(txDbRes.rows[0]!.id)).toBe(true);

    // Parse state and PKCE challenge from auth URL
    const authUrl = new URL(startResult.authorizationUrl);
    const state = authUrl.searchParams.get('state')!;
    const nonce = authUrl.searchParams.get('nonce')!;
    const codeChallenge = authUrl.searchParams.get('code_challenge')!;

    const code = issuer.issueCode({ redirectUri, codeChallenge, nonce });

    // 2. Complete Callback
    issuer.setTokenClaims({
      sub: 'int-subject-42',
      email: 'integrator@example.com',
      email_verified: true,
      name: 'Integration User',
      nonce,
    });

    const callbackResult = await completeOidcLogin(
      {
        query: { code, state },
        transactionCookie: startResult.transactionCookieValue,
      },
      {
        crypto,
        transactionStore: txStore,
        sessionStore,
        oidc: oidcAdapter,
        identityResolution: { identityDirectory: tenancyAdapter, clock, idGenerator },
        generateId: () => idGenerator.generateId(),
        now: () => now,
        sessionIdleTtlSeconds: 1800,
        sessionAbsoluteTtlSeconds: 28800,
      },
    );

    expect(callbackResult.returnTo).toBe('/dashboard/campaigns');
    expect(callbackResult.sessionToken).toBeDefined();
    expect(callbackResult.sessionToken.length).toBe(43);

    // Verify user was provisioned in PostgreSQL with valid UUIDv7
    const userRes = await client.query(
      `SELECT id, identity_provider, identity_subject, email, display_name, status FROM users WHERE identity_subject = 'int-subject-42'`,
    );
    expect(userRes.rowCount).toBe(1);
    expect(isValidUuidV7(userRes.rows[0].id)).toBe(true);
    expect(userRes.rows[0].email).toBe('integrator@example.com');
    expect(userRes.rows[0].status).toBe('active');

    // 3. Authenticate Session
    const authContext = await authenticateApplicationSession(
      { sessionCookie: callbackResult.sessionToken },
      {
        crypto,
        sessionStore,
        now: () => new Date('2026-11-02T12:05:00.000Z'),
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );

    expect(authContext.user.id).toBe(userRes.rows[0].id);
    expect(authContext.session.userId).toBe(userRes.rows[0].id);
    expect(isValidUuidV7(authContext.session.id)).toBe(true);
    expect(isValidUuidV7(authContext.session.userId)).toBe(true);
    expect(authContext.rotatedToken).toBeNull(); // 5 min elapsed, rotation threshold is 15 min

    // 4. Get Current User & Workspaces
    const currentUser = await getCurrentUser(authContext, { workspaceSummary });
    expect(currentUser.user.id).toBe(userRes.rows[0].id);
    expect(currentUser.user.email).toBe('integrator@example.com');
    expect(currentUser.workspaceAccess.items).toEqual([]);
    expect(currentUser.workspaceAccess.hasMore).toBe(false);

    // 5. Logout Session
    await logoutApplicationSession(
      { sessionCookie: callbackResult.sessionToken },
      { crypto, sessionStore, now: () => new Date('2026-11-02T12:10:00.000Z') },
    );

    // Verify token hash is scrubbed in PostgreSQL
    const sessionDbRes = await client.query(
      `SELECT current_token_hash, previous_token_hash, revoked_at, revocation_reason FROM application_sessions WHERE id = $1`,
      [authContext.session.id],
    );
    expect(sessionDbRes.rows[0].current_token_hash).toBeNull();
    expect(sessionDbRes.rows[0].previous_token_hash).toBeNull();
    expect(sessionDbRes.rows[0].revoked_at).not.toBeNull();
    expect(sessionDbRes.rows[0].revocation_reason).toBe('logout');

    // Subsequent authentication must fail
    await expect(
      authenticateApplicationSession(
        { sessionCookie: callbackResult.sessionToken },
        {
          crypto,
          sessionStore,
          now: () => new Date('2026-11-02T12:15:00.000Z'),
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ).rejects.toThrow(AuthenticationRequiredError);
  });
});
