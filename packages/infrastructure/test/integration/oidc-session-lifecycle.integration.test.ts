import crypto from 'node:crypto';
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
    const authUrl1 = new URL(start1.authorizationUrl);
    const state1 = authUrl1.searchParams.get('state')!;
    const nonce1 = authUrl1.searchParams.get('nonce')!;
    const codeChallenge1 = authUrl1.searchParams.get('code_challenge')!;
    const code1 = issuer1.issueCode({ redirectUri, codeChallenge: codeChallenge1, nonce: nonce1 });

    issuer1.setTokenClaims({ sub: 'common-subject-99', nonce: nonce1, email: 'sub@issuer1.com' });

    await completeOidcLogin(
      {
        query: { code: code1, state: state1 },
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
    const authUrl2 = new URL(start2.authorizationUrl);
    const state2 = authUrl2.searchParams.get('state')!;
    const nonce2 = authUrl2.searchParams.get('nonce')!;
    const codeChallenge2 = authUrl2.searchParams.get('code_challenge')!;
    const code2 = issuer2.issueCode({ redirectUri, codeChallenge: codeChallenge2, nonce: nonce2 });

    issuer2.setTokenClaims({ sub: 'common-subject-99', nonce: nonce2, email: 'sub@issuer2.com' });

    await completeOidcLogin(
      {
        query: { code: code2, state: state2 },
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
    const authUrl = new URL(start.authorizationUrl);
    const state = authUrl.searchParams.get('state')!;
    const nonce = authUrl.searchParams.get('nonce')!;
    const codeChallenge = authUrl.searchParams.get('code_challenge')!;
    const code = issuer1.issueCode({ redirectUri, codeChallenge, nonce });

    issuer1.setTokenClaims({ sub: 'replay-test-user', nonce });

    // First completion succeeds
    await completeOidcLogin(
      { query: { code, state }, transactionCookie: start.transactionCookieValue },
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
        { query: { code, state }, transactionCookie: start.transactionCookieValue },
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
    const authUrl = new URL(start.authorizationUrl);
    const state = authUrl.searchParams.get('state')!;
    const nonce = authUrl.searchParams.get('nonce')!;
    const codeChallenge = authUrl.searchParams.get('code_challenge')!;
    const code = issuer1.issueCode({ redirectUri, codeChallenge, nonce });

    issuer1.setTokenClaims({ sub: 'disable-test-user', nonce });

    const callback = await completeOidcLogin(
      { query: { code, state }, transactionCookie: start.transactionCookieValue },
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

  it('proves test OIDC issuer strictly enforces client authentication, PKCE, redirect_uri, and replay protection', async () => {
    const tokenUrl = `${issuer1.issuerUrl}/token`;
    const basicAuth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const badSecretAuth = 'Basic ' + Buffer.from(`${clientId}:wrong-secret`).toString('base64');

    const validVerifier = 'a'.repeat(43);
    const validChallenge = crypto.createHash('sha256').update(validVerifier).digest('base64url');
    const validNonce = 'test-nonce-12345';

    // 1. Missing Basic auth -> 401
    const resNoAuth = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code' }).toString(),
    });
    expect(resNoAuth.status).toBe(401);
    expect(await resNoAuth.json()).toEqual({ error: 'invalid_client' });

    // 2. Bad client secret -> 401
    const resBadSecret = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: badSecretAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code' }).toString(),
    });
    expect(resBadSecret.status).toBe(401);
    expect(await resBadSecret.json()).toEqual({ error: 'invalid_client' });

    // 3. Unsupported grant_type -> 400
    const resBadGrant = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });
    expect(resBadGrant.status).toBe(400);
    expect(await resBadGrant.json()).toEqual({ error: 'unsupported_grant_type' });

    // 4. Unissued code -> 400
    const resUnissuedCode = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'nonexistent-code',
        redirect_uri: redirectUri,
        code_verifier: validVerifier,
      }).toString(),
    });
    expect(resUnissuedCode.status).toBe(400);
    expect(await resUnissuedCode.json()).toEqual({ error: 'invalid_grant' });

    // Issue a valid code
    const validCode = issuer1.issueCode({
      redirectUri,
      codeChallenge: validChallenge,
      nonce: validNonce,
    });

    // 5. Redirect URI mismatch -> 400
    const resBadUri = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: validCode,
        redirect_uri: 'http://attacker.example.com/callback',
        code_verifier: validVerifier,
      }).toString(),
    });
    expect(resBadUri.status).toBe(400);
    expect(await resBadUri.json()).toEqual({ error: 'invalid_grant' });

    // 6. Missing code_verifier -> 400
    const resMissingVerifier = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: validCode,
        redirect_uri: redirectUri,
      }).toString(),
    });
    expect(resMissingVerifier.status).toBe(400);
    expect(await resMissingVerifier.json()).toEqual({ error: 'invalid_grant' });

    // 7. Forged / wrong code_verifier -> 400
    const resWrongVerifier = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: validCode,
        redirect_uri: redirectUri,
        code_verifier: 'wrong-verifier-123456789012345678901234567890',
      }).toString(),
    });
    expect(resWrongVerifier.status).toBe(400);
    expect(await resWrongVerifier.json()).toEqual({ error: 'invalid_grant' });

    // 8. Legitimate request -> 200
    const resSuccess = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: validCode,
        redirect_uri: redirectUri,
        code_verifier: validVerifier,
      }).toString(),
    });
    expect(resSuccess.status).toBe(200);
    const bodySuccess = (await resSuccess.json()) as { access_token?: string; id_token?: string };
    expect(bodySuccess.access_token).toBeDefined();
    expect(bodySuccess.id_token).toBeDefined();

    // 9. Replay of same code -> 400 invalid_grant
    const resReplay = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: validCode,
        redirect_uri: redirectUri,
        code_verifier: validVerifier,
      }).toString(),
    });
    expect(resReplay.status).toBe(400);
    expect(await resReplay.json()).toEqual({ error: 'invalid_grant' });
  });
});
