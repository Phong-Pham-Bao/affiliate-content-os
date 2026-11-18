import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CallbackResultForbiddenError,
  generateUuidV7,
  IdempotencyKeyReusedError,
  OAuthTransactionExpiredError,
  OAuthTransactionReplayedError,
} from '@affiliate-content-os/application';
import { createDatabase, type Database } from '../../src/database/index.js';
import {
  LocalSocialCredentialProtector,
  PostgresSocialPersistenceAdapter,
} from '../../src/social/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Social Connections PostgreSQL Integration', () => {
  let testCtx: TestDatabaseContext;
  let pool: pg.Pool;
  let database: Database;
  let adapter: PostgresSocialPersistenceAdapter;
  const protectorKey = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';
  const protector = new LocalSocialCredentialProtector(protectorKey, 'v1');

  const wsId1 = generateUuidV7();
  const wsId2 = generateUuidV7();
  const userId = generateUuidV7();
  const userId2 = generateUuidV7();

  beforeAll(async () => {
    testCtx = await setupIsolatedTestDatabase();
    pool = new pg.Pool({ connectionString: testCtx.dbUrl });
    database = createDatabase({
      databaseUrl: testCtx.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 30000,
      statementTimeoutMs: 15000,
      sslMode: 'disable',
    });
    adapter = new PostgresSocialPersistenceAdapter(database);

    // Seed test users and workspaces
    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, status, created_at, updated_at)
       VALUES ($1, 'google', 'sub-1', 'user@example.com', 'active', NOW(), NOW()),
              ($2, 'google', 'sub-2', 'user2@example.com', 'active', NOW(), NOW())`,
      [userId, userId2],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at)
       VALUES ($1, 'Workspace 1', 'ws-1', 'UTC', 'active', NOW(), NOW()),
              ($2, 'Workspace 2', 'ws-2', 'UTC', 'active', NOW(), NOW())`,
      [wsId1, wsId2],
    );
  });

  afterAll(async () => {
    await database.close();
    await pool.end();
    await testCtx.cleanup();
  });

  it('saves an OAuth transaction and finds it by state hash', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 600000);

    const saved = await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
      returnTo: '/connections',
      requestedScopes: ['threads_basic', 'threads_content_publish'],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    expect(saved.id).toBe(txId);
    expect(saved.status).toBe('pending');

    const found = await adapter.findPendingTransactionByStateHash(stateHash);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(txId);
  });

  it('authoritatively binds account ID in credential AAD, supports decryption, and handles rotation', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 600000);

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
      returnTo: '/connections',
      requestedScopes: ['threads_basic'],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    // 1. Claim transaction before completion
    const claimed = await adapter.claimOAuthTransaction({
      stateHash,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });
    expect(claimed.id).toBe(txId);

    const resultKey = crypto.randomBytes(32).toString('base64url');
    const resultKeyHash = crypto.createHash('sha256').update(resultKey, 'utf8').digest();

    // 2. Complete callback with encryptCredentials closure binding authoritative account ID
    const { account, callbackResult } = await adapter.completeOAuthCallbackAtomic({
      transactionId: txId,
      stateHash,
      workspaceId: wsId1,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'th_user_binding_test',
      displayName: 'Binding Test Creator',
      handle: '@bindingcreator',
      grantedScopes: ['threads_basic'],
      capabilities: { canPublishText: true, canPublishMedia: false },
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      encryptCredentials: (targetAccountId: string) =>
        protector.encrypt({
          workspaceId: wsId1,
          socialAccountId: targetAccountId,
          platform: 'threads',
          accessToken: 'initial_secret_access_token_123',
          refreshToken: 'initial_secret_refresh_token_456',
        }),
      resultKeyHash,
      resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
      now: now.toISOString(),
    });

    expect(account.status).toBe('active');
    expect(callbackResult.status).toBe('success');

    // 3. Read raw credentials from database and decrypt using protector
    const credRows = await pool.query(
      `SELECT access_token_ciphertext, access_token_iv, access_token_auth_tag,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
              encryption_key_version
       FROM social_credentials
       WHERE social_account_id = $1`,
      [account.id],
    );
    expect(credRows.rows).toHaveLength(1);
    const row = credRows.rows[0];

    const decrypted = protector.decrypt({
      workspaceId: wsId1,
      socialAccountId: account.id,
      platform: 'threads',
      credentials: {
        accessTokenCiphertext: new Uint8Array(row.access_token_ciphertext),
        accessTokenIv: new Uint8Array(row.access_token_iv),
        accessTokenAuthTag: new Uint8Array(row.access_token_auth_tag),
        refreshTokenCiphertext: new Uint8Array(row.refresh_token_ciphertext),
        refreshTokenIv: new Uint8Array(row.refresh_token_iv),
        refreshTokenAuthTag: new Uint8Array(row.refresh_token_auth_tag),
        keyVersion: row.encryption_key_version,
      },
    });

    expect(decrypted.accessToken).toBe('initial_secret_access_token_123');
    expect(decrypted.refreshToken).toBe('initial_secret_refresh_token_456');

    // 4. Negative test: decrypting with tampered socialAccountId MUST fail (AAD mismatch)
    const tamperedAccountId = generateUuidV7();
    expect(() =>
      protector.decrypt({
        workspaceId: wsId1,
        socialAccountId: tamperedAccountId,
        platform: 'threads',
        credentials: {
          accessTokenCiphertext: new Uint8Array(row.access_token_ciphertext),
          accessTokenIv: new Uint8Array(row.access_token_iv),
          accessTokenAuthTag: new Uint8Array(row.access_token_auth_tag),
          refreshTokenCiphertext: new Uint8Array(row.refresh_token_ciphertext),
          refreshTokenIv: new Uint8Array(row.refresh_token_iv),
          refreshTokenAuthTag: new Uint8Array(row.refresh_token_auth_tag),
          keyVersion: row.encryption_key_version,
        },
      }),
    ).toThrow();

    // 5. Account rotation: connect same provider account again with new tokens
    const rawState2 = crypto.randomBytes(32).toString('base64url');
    const stateHash2 = crypto.createHash('sha256').update(rawState2, 'utf8').digest();
    const txId2 = generateUuidV7();

    await adapter.saveOAuthTransaction({
      id: txId2,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash: stateHash2,
      redirectUri: 'http://localhost:3001/api/v1/social-connections/threads/callback',
      returnTo: '/connections',
      requestedScopes: ['threads_basic', 'threads_content_publish'],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    await adapter.claimOAuthTransaction({
      stateHash: stateHash2,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    const rotatedResult = await adapter.completeOAuthCallbackAtomic({
      transactionId: txId2,
      stateHash: stateHash2,
      workspaceId: wsId1,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'th_user_binding_test',
      displayName: 'Rotated Display Name',
      handle: '@rotatedhandle',
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilities: { canPublishText: true, canPublishMedia: true },
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      encryptCredentials: (targetAccountId: string) => {
        expect(targetAccountId).toBe(account.id);
        return protector.encrypt({
          workspaceId: wsId1,
          socialAccountId: targetAccountId,
          platform: 'threads',
          accessToken: 'rotated_new_access_token_789',
          refreshToken: 'rotated_new_refresh_token_012',
        });
      },
      resultKeyHash: crypto.createHash('sha256').update('rot-key').digest(),
      resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
      now: now.toISOString(),
    });

    expect(rotatedResult.account.id).toBe(account.id);
    expect(rotatedResult.account.version).toBe(account.version + 1);
    expect(rotatedResult.account.displayName).toBe('Rotated Display Name');

    // Verify rotated credentials in DB decrypt with the existing account.id
    const rotatedCredRows = await pool.query(
      `SELECT access_token_ciphertext, access_token_iv, access_token_auth_tag,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
              encryption_key_version
       FROM social_credentials
       WHERE social_account_id = $1`,
      [account.id],
    );
    const rotRow = rotatedCredRows.rows[0];
    const rotatedDecrypted = protector.decrypt({
      workspaceId: wsId1,
      socialAccountId: account.id,
      platform: 'threads',
      credentials: {
        accessTokenCiphertext: new Uint8Array(rotRow.access_token_ciphertext),
        accessTokenIv: new Uint8Array(rotRow.access_token_iv),
        accessTokenAuthTag: new Uint8Array(rotRow.access_token_auth_tag),
        refreshTokenCiphertext: new Uint8Array(rotRow.refresh_token_ciphertext),
        refreshTokenIv: new Uint8Array(rotRow.refresh_token_iv),
        refreshTokenAuthTag: new Uint8Array(rotRow.refresh_token_auth_tag),
        keyVersion: rotRow.encryption_key_version,
      },
    });
    expect(rotatedDecrypted.accessToken).toBe('rotated_new_access_token_789');
    expect(rotatedDecrypted.refreshToken).toBe('rotated_new_refresh_token_012');
  });

  it('guarantees exactly one claimant wins under true concurrent callback claims', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600000).toISOString(),
    });

    // Run two concurrent claim attempts
    const claimParams = {
      stateHash,
      platform: 'threads' as const,
      now: now.toISOString(),
      claimTtlSeconds: 120,
    };

    const [res1, res2] = await Promise.allSettled([
      adapter.claimOAuthTransaction(claimParams),
      adapter.claimOAuthTransaction(claimParams),
    ]);

    const fulfilledCount =
      (res1.status === 'fulfilled' ? 1 : 0) + (res2.status === 'fulfilled' ? 1 : 0);
    const rejectedCount =
      (res1.status === 'rejected' ? 1 : 0) + (res2.status === 'rejected' ? 1 : 0);

    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const rejected = res1.status === 'rejected' ? res1 : res2;
    if (rejected.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(OAuthTransactionReplayedError);
    }

    // Verify DB state is 'claimed'
    const txCheck = await pool.query(
      `SELECT status, claimed_at, claimed_expires_at FROM oauth_transactions WHERE id = $1`,
      [txId],
    );
    expect(txCheck.rows[0]?.status).toBe('claimed');
    expect(txCheck.rows[0]?.claimed_at).not.toBeNull();
    expect(txCheck.rows[0]?.claimed_expires_at).not.toBeNull();
  });

  it('fails closed when attempting to complete an unclaimed transaction', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600000).toISOString(),
    });

    // Attempt to complete directly without claim
    await expect(
      adapter.completeOAuthCallbackAtomic({
        transactionId: txId,
        stateHash,
        workspaceId: wsId1,
        platform: 'threads',
        actorUserId: userId,
        providerAccountId: 'user-unclaimed',
        displayName: 'User Unclaimed',
        handle: null,
        grantedScopes: [],
        capabilities: {},
        capabilitiesCheckedAt: now.toISOString(),
        tokenExpiresAt: null,
        environment: 'local',
        encryptCredentials: () =>
          protector.encrypt({
            workspaceId: wsId1,
            socialAccountId: generateUuidV7(),
            platform: 'threads',
            accessToken: 'token-unclaimed',
          }),
        resultKeyHash: crypto.createHash('sha256').update('res-unclaimed').digest(),
        resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
        now: now.toISOString(),
      }),
    ).rejects.toThrow(OAuthTransactionReplayedError);
  });

  it('fails closed when attempting to claim an expired transaction', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const past = new Date(Date.now() - 600000);
    const expiredAt = new Date(Date.now() - 300000);

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: [],
      createdAt: past.toISOString(),
      expiresAt: expiredAt.toISOString(),
    });

    await expect(
      adapter.claimOAuthTransaction({
        stateHash,
        platform: 'threads',
        now: new Date().toISOString(),
        claimTtlSeconds: 120,
      }),
    ).rejects.toThrow(OAuthTransactionExpiredError);
  });

  it('atomically enforces authorize idempotency under concurrent execution with advisory locks', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const idemKey = `idem-${generateUuidV7()}`;
    const keyHash = crypto.createHash('sha256').update(idemKey, 'utf8').digest();
    const requestHash = crypto
      .createHash('sha256')
      .update('{"platform":"threads"}', 'utf8')
      .digest();
    const now = new Date();
    const routeKey = 'POST /api/v1/workspaces/:workspaceId/social-connections/threads/authorize';

    const txId1 = generateUuidV7();
    const txId2 = generateUuidV7();

    const makeParams = (txId: string) => ({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads' as const,
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/connections',
      requestedScopes: ['threads_basic'],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600000).toISOString(),
      idempotencyKey: idemKey,
      keyHash,
      requestHash,
      routeKey,
      responseData: {
        authorizationUrl: `https://threads.net/oauth/authorize?state=${rawState}`,
        transactionId: txId,
        expiresAt: new Date(now.getTime() + 600000).toISOString(),
      },
    });

    // Run concurrently
    const [res1, res2] = await Promise.all([
      adapter.saveOAuthTransactionWithIdempotency(makeParams(txId1)),
      adapter.saveOAuthTransactionWithIdempotency(makeParams(txId2)),
    ]);

    // One must be fresh, one must be replayed
    const replayedCount = (res1.replayed ? 1 : 0) + (res2.replayed ? 1 : 0);
    expect(replayedCount).toBe(1);

    // Both must return identical response data
    expect(res1.response.authorizationUrl).toBe(res2.response.authorizationUrl);
    expect(res1.response.transactionId).toBe(res2.response.transactionId);

    // Verify exactly 1 row in idempotency_keys
    const idemCheck = await pool.query(
      `SELECT count(*) FROM idempotency_keys WHERE workspace_id = $1 AND key_hash = $2`,
      [wsId1, Buffer.from(keyHash)],
    );
    expect(Number(idemCheck.rows[0]?.count)).toBe(1);

    // Verify exactly 1 transaction was inserted for this stateHash
    const txCount = await pool.query(
      `SELECT count(*) FROM oauth_transactions WHERE workspace_id = $1 AND state_hash = $2`,
      [wsId1, Buffer.from(stateHash)],
    );
    expect(Number(txCount.rows[0]?.count)).toBe(1);

    // Reusing the same idempotency key with a DIFFERENT request payload must throw IdempotencyKeyReusedError (409)
    const diffRequestHash = crypto
      .createHash('sha256')
      .update('{"platform":"threads","modified":true}', 'utf8')
      .digest();
    await expect(
      adapter.saveOAuthTransactionWithIdempotency({
        ...makeParams(generateUuidV7()),
        requestHash: diffRequestHash,
      }),
    ).rejects.toThrow(IdempotencyKeyReusedError);
  });

  it('enforces actor-bound callback result consumption and forbids cross-actor consumption', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600000).toISOString(),
    });

    await adapter.claimOAuthTransaction({
      stateHash,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    const resultKey = crypto.randomBytes(32).toString('base64url');
    const resultKeyHash = crypto.createHash('sha256').update(resultKey, 'utf8').digest();

    await adapter.completeOAuthCallbackAtomic({
      transactionId: txId,
      stateHash,
      workspaceId: wsId1,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'user-actor-bound',
      displayName: 'Actor Bound User',
      handle: null,
      grantedScopes: [],
      capabilities: {},
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      encryptCredentials: (targetAccountId: string) =>
        protector.encrypt({
          workspaceId: wsId1,
          socialAccountId: targetAccountId,
          platform: 'threads',
          accessToken: 'actor-bound-token',
        }),
      resultKeyHash,
      resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
      now: now.toISOString(),
    });

    // 1. Cross-actor consumption in same workspace (userId2) MUST throw CallbackResultForbiddenError
    await expect(
      adapter.consumeCallbackResult({
        workspaceId: wsId1,
        actorUserId: userId2,
        resultKeyHash,
        now: now.toISOString(),
      }),
    ).rejects.toThrow(CallbackResultForbiddenError);

    // 2. Initiating actor (userId) successfully consumes
    const consumed = await adapter.consumeCallbackResult({
      workspaceId: wsId1,
      actorUserId: userId,
      resultKeyHash,
      now: now.toISOString(),
    });
    expect(consumed).not.toBeNull();
    expect(consumed?.status).toBe('success');

    // 3. Consuming again returns null (single-use)
    const reConsumed = await adapter.consumeCallbackResult({
      workspaceId: wsId1,
      actorUserId: userId,
      resultKeyHash,
      now: now.toISOString(),
    });
    expect(reConsumed).toBeNull();
  });

  it('rejects cross-tenant callback result consumption (tenant isolation)', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600000).toISOString(),
    });

    await adapter.claimOAuthTransaction({
      stateHash,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    const resultKey = crypto.randomBytes(32).toString('base64url');
    const resultKeyHash = crypto.createHash('sha256').update(resultKey, 'utf8').digest();

    await adapter.completeOAuthCallbackAtomic({
      transactionId: txId,
      stateHash,
      workspaceId: wsId1,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'user-tenant-check',
      displayName: 'Tenant Check',
      handle: null,
      grantedScopes: [],
      capabilities: {},
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      encryptCredentials: (targetAccountId: string) =>
        protector.encrypt({
          workspaceId: wsId1,
          socialAccountId: targetAccountId,
          platform: 'threads',
          accessToken: 'secret',
        }),
      resultKeyHash,
      resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
      now: now.toISOString(),
    });

    // Querying with workspace 2 must return null
    const crossTenantConsume = await adapter.consumeCallbackResult({
      workspaceId: wsId2,
      actorUserId: userId,
      resultKeyHash,
      now: now.toISOString(),
    });
    expect(crossTenantConsume).toBeNull();
  });

  it('converges concurrent callback completions for the same new provider identity via advisory locking into one active account with rotated credentials', async () => {
    const rawState1 = crypto.randomBytes(32).toString('base64url');
    const stateHash1 = crypto.createHash('sha256').update(rawState1, 'utf8').digest();
    const txId1 = generateUuidV7();

    const rawState2 = crypto.randomBytes(32).toString('base64url');
    const stateHash2 = crypto.createHash('sha256').update(rawState2, 'utf8').digest();
    const txId2 = generateUuidV7();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 600000);

    // 1. Save two distinct OAuth transactions
    await adapter.saveOAuthTransaction({
      id: txId1,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash: stateHash1,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: ['threads_basic'],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    await adapter.saveOAuthTransaction({
      id: txId2,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash: stateHash2,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: ['threads_basic'],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    // 2. Claim both transactions (simulating two parallel external exchanges that both succeeded)
    await adapter.claimOAuthTransaction({
      stateHash: stateHash1,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    await adapter.claimOAuthTransaction({
      stateHash: stateHash2,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    const sharedProviderAccountId = `same_identity_${Date.now()}`;
    const resultKeyHash1 = crypto.createHash('sha256').update('res-key-1').digest();
    const resultKeyHash2 = crypto.createHash('sha256').update('res-key-2').digest();

    // 3. Complete concurrently for the same provider identity
    const [res1, res2] = await Promise.all([
      adapter.completeOAuthCallbackAtomic({
        transactionId: txId1,
        stateHash: stateHash1,
        workspaceId: wsId1,
        platform: 'threads',
        actorUserId: userId,
        providerAccountId: sharedProviderAccountId,
        displayName: 'First Concurrent Attempt',
        handle: '@first_concurrent',
        grantedScopes: ['threads_basic'],
        capabilities: { canPublishText: true },
        capabilitiesCheckedAt: now.toISOString(),
        tokenExpiresAt: null,
        environment: 'local',
        encryptCredentials: (authoritativeAccountId: string) =>
          protector.encrypt({
            workspaceId: wsId1,
            socialAccountId: authoritativeAccountId,
            platform: 'threads',
            accessToken: 'token_attempt_1',
          }),
        resultKeyHash: resultKeyHash1,
        resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
        now: now.toISOString(),
      }),
      adapter.completeOAuthCallbackAtomic({
        transactionId: txId2,
        stateHash: stateHash2,
        workspaceId: wsId1,
        platform: 'threads',
        actorUserId: userId,
        providerAccountId: sharedProviderAccountId,
        displayName: 'Second Concurrent Attempt',
        handle: '@second_concurrent',
        grantedScopes: ['threads_basic', 'threads_content_publish'],
        capabilities: { canPublishText: true, canPublishMedia: true },
        capabilitiesCheckedAt: now.toISOString(),
        tokenExpiresAt: null,
        environment: 'local',
        encryptCredentials: (authoritativeAccountId: string) =>
          protector.encrypt({
            workspaceId: wsId1,
            socialAccountId: authoritativeAccountId,
            platform: 'threads',
            accessToken: 'token_attempt_2',
          }),
        resultKeyHash: resultKeyHash2,
        resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
        now: now.toISOString(),
      }),
    ]);

    // Both operations must settle successfully without unique constraint failure
    expect(res1.account.id).toBe(res2.account.id);
    const authoritativeAccountId = res1.account.id;

    // Exactly one active account exists in PostgreSQL
    const accountCheck = await pool.query(
      `SELECT id, status, provider_account_id, version FROM social_accounts WHERE workspace_id = $1 AND platform = 'threads' AND provider_account_id = $2`,
      [wsId1, sharedProviderAccountId],
    );
    expect(accountCheck.rowCount).toBe(1);
    expect(accountCheck.rows[0]?.id).toBe(authoritativeAccountId);
    expect(accountCheck.rows[0]?.status).toBe('active');
    expect(Number(accountCheck.rows[0]?.version)).toBe(2);

    // Stored credentials decrypt using the authoritative account ID and contain last-writer tokens
    const credRows = await pool.query(
      `SELECT social_account_id, access_token_ciphertext, access_token_iv, access_token_auth_tag,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
              encryption_key_version
       FROM social_credentials
       WHERE workspace_id = $1 AND social_account_id = $2`,
      [wsId1, authoritativeAccountId],
    );
    expect(credRows.rowCount).toBe(1);
    expect(credRows.rows[0]?.social_account_id).toBe(authoritativeAccountId);

    const decrypted = protector.decrypt({
      workspaceId: wsId1,
      socialAccountId: authoritativeAccountId,
      platform: 'threads',
      credentials: {
        accessTokenCiphertext: new Uint8Array(credRows.rows[0].access_token_ciphertext),
        accessTokenIv: new Uint8Array(credRows.rows[0].access_token_iv),
        accessTokenAuthTag: new Uint8Array(credRows.rows[0].access_token_auth_tag),
        refreshTokenCiphertext: null,
        refreshTokenIv: null,
        refreshTokenAuthTag: null,
        keyVersion: credRows.rows[0].encryption_key_version,
      },
    });
    expect(['token_attempt_1', 'token_attempt_2']).toContain(decrypted.accessToken);

    // Assert zero orphan credentials exist in the workspace
    const allCredRows = await pool.query(
      `SELECT sc.social_account_id
       FROM social_credentials sc
       LEFT JOIN social_accounts sa ON sa.id = sc.social_account_id
       WHERE sc.workspace_id = $1 AND sa.id IS NULL`,
      [wsId1],
    );
    expect(allCredRows.rowCount).toBe(0);

    // Each transaction has at most one terminal callback result
    const cbCheck = await pool.query(
      `SELECT transaction_id, status FROM oauth_callback_results WHERE transaction_id IN ($1, $2)`,
      [txId1, txId2],
    );
    expect(cbCheck.rowCount).toBe(2);
    expect(cbCheck.rows.map((r) => r.status).sort()).toEqual(['success', 'success']);
  });

  it('records allowlisted social_connection.authorization_claimed audit event on successful claim and omits sensitive values', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: ['threads_basic'],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600000).toISOString(),
    });

    const testIpHash = crypto.createHash('sha256').update('127.0.0.1').digest('hex');

    await adapter.claimOAuthTransaction({
      stateHash,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
      auditContext: { ipHash: testIpHash, userAgentSummary: 'test-agent' },
    });

    const auditRes = await pool.query(
      `SELECT action, resource_type, resource_id, result, changes_json, ip_hash, user_agent_summary
       FROM audit_events
       WHERE workspace_id = $1 AND resource_id = $2 AND action = 'social_connection.authorization_claimed'`,
      [wsId1, txId],
    );

    expect(auditRes.rowCount).toBe(1);
    const auditRow = auditRes.rows[0];
    expect(auditRow?.action).toBe('social_connection.authorization_claimed');
    expect(auditRow?.resource_type).toBe('oauth_transaction');
    expect(auditRow?.result).toBe('succeeded');
    expect(auditRow?.ip_hash).toBe(testIpHash);
    expect(auditRow?.user_agent_summary).toBe('test-agent');

    // Verify sensitive data (raw state, verifiers, tokens, code) are absent
    const auditJson = JSON.stringify(auditRow);
    expect(auditJson).not.toContain(rawState);
    expect(auditRow?.changes_json).not.toHaveProperty('code');
    expect(auditRow?.changes_json).not.toHaveProperty('token');
    expect(auditRow?.changes_json).not.toHaveProperty('verifier');
    expect(auditJson).not.toContain('ciphertext');
  });

  it('records allowlisted social_connection.replay_rejected audit event on replay rejection and omits sensitive values', async () => {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: ['threads_basic'],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600000).toISOString(),
    });

    // First claim succeeds
    await adapter.claimOAuthTransaction({
      stateHash,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    const replayIpHash = crypto.createHash('sha256').update('127.0.0.1').digest('hex');

    // Second claim attempts replay and must throw OAuthTransactionReplayedError
    await expect(
      adapter.claimOAuthTransaction({
        stateHash,
        platform: 'threads',
        now: now.toISOString(),
        claimTtlSeconds: 120,
        auditContext: { ipHash: replayIpHash, userAgentSummary: 'replay-agent' },
      }),
    ).rejects.toThrow(OAuthTransactionReplayedError);

    const auditRes = await pool.query(
      `SELECT action, resource_type, resource_id, result, reason_code, changes_json, ip_hash, user_agent_summary
       FROM audit_events
       WHERE workspace_id = $1 AND resource_id = $2 AND action = 'social_connection.replay_rejected'`,
      [wsId1, txId],
    );

    expect(auditRes.rowCount).toBe(1);
    const auditRow = auditRes.rows[0];
    expect(auditRow?.action).toBe('social_connection.replay_rejected');
    expect(auditRow?.resource_type).toBe('oauth_transaction');
    expect(auditRow?.result).toBe('denied');
    expect(auditRow?.reason_code).toBe('transaction_already_claimed');
    expect(auditRow?.ip_hash).toBe(replayIpHash);
    expect(auditRow?.user_agent_summary).toBe('replay-agent');

    // Verify sensitive data are absent
    const auditJson = JSON.stringify(auditRow);
    expect(auditJson).not.toContain(rawState);
    expect(auditRow?.changes_json).not.toHaveProperty('code');
    expect(auditRow?.changes_json).not.toHaveProperty('token');
    expect(auditRow?.changes_json).not.toHaveProperty('verifier');
    expect(auditJson).not.toContain('ciphertext');
  });
});
