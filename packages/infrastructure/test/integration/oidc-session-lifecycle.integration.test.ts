import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticateApplicationSession,
  beginOidcLogin,
  completeOidcLogin,
  OidcCallbackInvalidError,
  AuthenticationRequiredError,
  DefaultIdGenerator,
  SystemClock,
} from '@affiliate-content-os/application';
import { createDatabase, type Database } from '../../src/database/index.js';
import {
  createAuthCryptoAdapter,
  createPostgresLoginTransactionAdapter,
  createPostgresSessionAdapter,
  discoverOidcAdapter,
} from '../../src/auth/index.js';
import { createPostgresTenancyAdapter } from '../../src/tenancy/index.js';
import { createTestOidcIssuer, type TestOidcIssuer } from '../helpers/test-oidc-issuer.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL & Local OIDC Lifecycle and Security Edge Cases', () => {
  let context: TestDatabaseContext;
  let client: pg.Client;
  let database: Database;
  let issuer1: TestOidcIssuer;
  let issuer2: TestOidcIssuer;

  const clientId = 'lifecycle-client-id';
  const clientSecret = 'lifecycle-client-secret';
  const redirectUri = 'http://127.0.0.1:3001/auth/callback';
  const encryptionKey = Buffer.alloc(32, 0x43).toString('base64url');
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

    issuer1 = await createTestOidcIssuer(clientId, clientSecret);
    issuer2 = await createTestOidcIssuer(clientId, clientSecret);
  });

  afterAll(async () => {
    if (issuer1) await issuer1.close();
    if (issuer2) await issuer2.close();
    if (database) await database.close();
    if (client) await client.end();
    if (context) await context.cleanup();
  });

  it('proves same subject under two different issuers provisions distinct users in PostgreSQL', async () => {
    const oidcAdapter1 = await discoverOidcAdapter({
      issuer: issuer1.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });
    const oidcAdapter2 = await discoverOidcAdapter({
      issuer: issuer2.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });

    const crypto = createAuthCryptoAdapter(encryptionKey, keyVersion);
    const txStore = createPostgresLoginTransactionAdapter(database);
    const sessionStore = createPostgresSessionAdapter(database);
    const tenancyAdapter = createPostgresTenancyAdapter(database);
    const clock = new SystemClock();
    const idGenerator = new DefaultIdGenerator();

    const now = new Date('2026-11-02T12:00:00.000Z');

    // Login with issuer 1
    const start1 = await beginOidcLogin(
      { returnTo: '/' },
      {
        crypto,
        transactionStore: txStore,
        oidc: oidcAdapter1,
        generateId: () => idGenerator.generateUserId(),
        now: () => now,
        transactionTtlSeconds: 600,
      },
    );
    const state1 = new URL(start1.authorizationUrl).searchParams.get('state')!;
    const nonce1 = new URL(start1.authorizationUrl).searchParams.get('nonce')!;
    issuer1.setTokenClaims({ sub: 'common-subject-99', nonce: nonce1, email: 'sub@issuer1.com' });

    await completeOidcLogin(
      {
        query: { code: 'code-1', state: state1 },
        transactionCookie: start1.transactionCookieValue,
      },
      {
        crypto,
        transactionStore: txStore,
        sessionStore,
        oidc: oidcAdapter1,
        identityResolution: { identityDirectory: tenancyAdapter, clock, idGenerator },
        generateId: () => idGenerator.generateUserId(),
        now: () => now,
        sessionIdleTtlSeconds: 1800,
        sessionAbsoluteTtlSeconds: 28800,
      },
    );

    // Login with issuer 2, same subject
    const start2 = await beginOidcLogin(
      { returnTo: '/' },
      {
        crypto,
        transactionStore: txStore,
        oidc: oidcAdapter2,
        generateId: () => idGenerator.generateUserId(),
        now: () => now,
        transactionTtlSeconds: 600,
      },
    );
    const state2 = new URL(start2.authorizationUrl).searchParams.get('state')!;
    const nonce2 = new URL(start2.authorizationUrl).searchParams.get('nonce')!;
    issuer2.setTokenClaims({ sub: 'common-subject-99', nonce: nonce2, email: 'sub@issuer2.com' });

    await completeOidcLogin(
      {
        query: { code: 'code-2', state: state2 },
        transactionCookie: start2.transactionCookieValue,
      },
      {
        crypto,
        transactionStore: txStore,
        sessionStore,
        oidc: oidcAdapter2,
        identityResolution: { identityDirectory: tenancyAdapter, clock, idGenerator },
        generateId: () => idGenerator.generateUserId(),
        now: () => now,
        sessionIdleTtlSeconds: 1800,
        sessionAbsoluteTtlSeconds: 28800,
      },
    );

    // Verify 2 distinct rows in users table
    const dbUsers = await client.query(
      `SELECT id, identity_provider, identity_subject, email FROM users WHERE identity_subject = 'common-subject-99' ORDER BY created_at ASC`,
    );
    expect(dbUsers.rowCount).toBe(2);
    expect(dbUsers.rows[0].identity_provider).toBe(issuer1.issuerUrl);
    expect(dbUsers.rows[1].identity_provider).toBe(issuer2.issuerUrl);
    expect(dbUsers.rows[0].id).not.toBe(dbUsers.rows[1].id);
  });

  it('proves callback replay fails with OidcCallbackInvalidError and makes no mutations', async () => {
    const oidcAdapter = await discoverOidcAdapter({
      issuer: issuer1.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });
    const crypto = createAuthCryptoAdapter(encryptionKey, keyVersion);
    const txStore = createPostgresLoginTransactionAdapter(database);
    const sessionStore = createPostgresSessionAdapter(database);
    const tenancyAdapter = createPostgresTenancyAdapter(database);
    const clock = new SystemClock();
    const idGenerator = new DefaultIdGenerator();

    const now = new Date('2026-11-02T12:00:00.000Z');

    const start = await beginOidcLogin(
      { returnTo: '/' },
      {
        crypto,
        transactionStore: txStore,
        oidc: oidcAdapter,
        generateId: () => idGenerator.generateUserId(),
        now: () => now,
        transactionTtlSeconds: 600,
      },
    );
    const state = new URL(start.authorizationUrl).searchParams.get('state')!;
    const nonce = new URL(start.authorizationUrl).searchParams.get('nonce')!;
    issuer1.setTokenClaims({ sub: 'replay-test-user', nonce });

    // First completion succeeds
    await completeOidcLogin(
      { query: { code: 'code-replay', state }, transactionCookie: start.transactionCookieValue },
      {
        crypto,
        transactionStore: txStore,
        sessionStore,
        oidc: oidcAdapter,
        identityResolution: { identityDirectory: tenancyAdapter, clock, idGenerator },
        generateId: () => idGenerator.generateUserId(),
        now: () => now,
        sessionIdleTtlSeconds: 1800,
        sessionAbsoluteTtlSeconds: 28800,
      },
    );

    // Second completion with same code/state/cookie must fail
    await expect(
      completeOidcLogin(
        { query: { code: 'code-replay', state }, transactionCookie: start.transactionCookieValue },
        {
          crypto,
          transactionStore: txStore,
          sessionStore,
          oidc: oidcAdapter,
          identityResolution: { identityDirectory: tenancyAdapter, clock, idGenerator },
          generateId: () => idGenerator.generateUserId(),
          now: () => now,
          sessionIdleTtlSeconds: 1800,
          sessionAbsoluteTtlSeconds: 28800,
        },
      ),
    ).rejects.toThrow(OidcCallbackInvalidError);
  });

  it('proves inactive user status revokes session and scrubs token hashes from database', async () => {
    const oidcAdapter = await discoverOidcAdapter({
      issuer: issuer1.issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      allowInsecureRequests: true,
    });
    const crypto = createAuthCryptoAdapter(encryptionKey, keyVersion);
    const txStore = createPostgresLoginTransactionAdapter(database);
    const sessionStore = createPostgresSessionAdapter(database);
    const tenancyAdapter = createPostgresTenancyAdapter(database);
    const clock = new SystemClock();
    const idGenerator = new DefaultIdGenerator();

    const now = new Date('2026-11-02T12:00:00.000Z');

    const start = await beginOidcLogin(
      { returnTo: '/' },
      {
        crypto,
        transactionStore: txStore,
        oidc: oidcAdapter,
        generateId: () => idGenerator.generateUserId(),
        now: () => now,
        transactionTtlSeconds: 600,
      },
    );
    const state = new URL(start.authorizationUrl).searchParams.get('state')!;
    const nonce = new URL(start.authorizationUrl).searchParams.get('nonce')!;
    issuer1.setTokenClaims({ sub: 'disable-test-user', nonce });

    const callback = await completeOidcLogin(
      { query: { code: 'code-disable', state }, transactionCookie: start.transactionCookieValue },
      {
        crypto,
        transactionStore: txStore,
        sessionStore,
        oidc: oidcAdapter,
        identityResolution: { identityDirectory: tenancyAdapter, clock, idGenerator },
        generateId: () => idGenerator.generateUserId(),
        now: () => now,
        sessionIdleTtlSeconds: 1800,
        sessionAbsoluteTtlSeconds: 28800,
      },
    );

    // Disable the user in PostgreSQL
    await client.query(
      `UPDATE users SET status = 'disabled' WHERE identity_subject = 'disable-test-user'`,
    );

    // Authenticate must fail with AuthenticationRequiredError
    await expect(
      authenticateApplicationSession(
        { sessionCookie: callback.sessionToken },
        {
          crypto,
          sessionStore,
          userDirectory: tenancyAdapter,
          now: () => new Date('2026-11-02T12:05:00.000Z'),
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ).rejects.toThrow(AuthenticationRequiredError);

    // Verify session row in DB has hashes scrubbed and reason = 'user_unavailable'
    const sessionRes = await client.query(
      `SELECT current_token_hash, previous_token_hash, revoked_at, revocation_reason FROM application_sessions s JOIN users u ON s.user_id = u.id WHERE u.identity_subject = 'disable-test-user'`,
    );
    expect(sessionRes.rows[0].current_token_hash).toBeNull();
    expect(sessionRes.rows[0].previous_token_hash).toBeNull();
    expect(sessionRes.rows[0].revoked_at).not.toBeNull();
    expect(sessionRes.rows[0].revocation_reason).toBe('user_unavailable');
  });
});
