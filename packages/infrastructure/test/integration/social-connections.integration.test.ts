import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  generateUuidV7,
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
       VALUES ($1, 'google', 'sub-1', 'user@example.com', 'active', NOW(), NOW())`,
      [userId],
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

  it('completes callback atomically into an active account with encrypted credentials and audit event', async () => {
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

    const encryptedCreds = protector.encrypt({
      workspaceId: wsId1,
      socialAccountId: generateUuidV7(),
      platform: 'threads',
      accessToken: 'threads_secret_token_abc',
      refreshToken: 'threads_refresh_token_xyz',
    });

    const resultKey = crypto.randomBytes(32).toString('base64url');
    const resultKeyHash = crypto.createHash('sha256').update(resultKey, 'utf8').digest();

    const { account, callbackResult } = await adapter.completeOAuthCallbackAtomic({
      transactionId: txId,
      stateHash,
      workspaceId: wsId1,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'th_user_999',
      displayName: 'Threads Creator',
      handle: '@threadscreator',
      grantedScopes: ['threads_basic'],
      capabilities: { canPublishText: true, canPublishMedia: false },
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      encryptedCredentials: encryptedCreds,
      resultKeyHash,
      resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
      now: now.toISOString(),
    });

    expect(account.status).toBe('active');
    expect(account.displayName).toBe('Threads Creator');
    expect(account.handle).toBe('@threadscreator');
    expect(callbackResult.status).toBe('success');

    // Verify transaction is marked consumed
    const txCheck = await pool.query(
      'SELECT status, consumed_at FROM oauth_transactions WHERE id = $1',
      [txId],
    );
    expect(txCheck.rows[0]?.status).toBe('consumed');
    expect(txCheck.rows[0]?.consumed_at).not.toBeNull();

    // Verify credentials table has encrypted token
    const credCheck = await pool.query(
      'SELECT access_token_ciphertext, encryption_key_version FROM social_credentials WHERE social_account_id = $1',
      [account.id],
    );
    expect(credCheck.rows[0]?.access_token_ciphertext).toBeDefined();
    expect(credCheck.rows[0]?.encryption_key_version).toBe('v1');

    // Verify audit event exists
    const auditCheck = await pool.query(
      `SELECT action, resource_type, resource_id FROM audit_events WHERE resource_id = $1`,
      [account.id],
    );
    expect(auditCheck.rows[0]?.action).toBe('social_connection.completed');

    // Verify listSocialAccounts does NOT select credentials
    const accounts = await adapter.listSocialAccounts({ workspaceId: wsId1 });
    expect(accounts.length).toBeGreaterThan(0);
    const listed = accounts.find((a) => a.id === account.id);
    expect(listed).toBeDefined();
    expect(
      (listed as unknown as Record<string, unknown>)['access_token_ciphertext'],
    ).toBeUndefined();

    // Consume callback result
    const consumedResult = await adapter.consumeCallbackResult({
      workspaceId: wsId1,
      resultKeyHash,
      now: now.toISOString(),
    });
    expect(consumedResult).not.toBeNull();
    expect(consumedResult?.status).toBe('success');

    // Consuming again returns null (single-use)
    const reConsumed = await adapter.consumeCallbackResult({
      workspaceId: wsId1,
      resultKeyHash,
      now: now.toISOString(),
    });
    expect(reConsumed).toBeNull();
  });

  it('fails closed when attempting to replay a consumed transaction', async () => {
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

    const encryptedCreds = protector.encrypt({
      workspaceId: wsId1,
      socialAccountId: generateUuidV7(),
      platform: 'threads',
      accessToken: 'token-1',
    });

    // Complete once
    await adapter.completeOAuthCallbackAtomic({
      transactionId: txId,
      stateHash,
      workspaceId: wsId1,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'user-replay',
      displayName: 'User Replay',
      handle: null,
      grantedScopes: [],
      capabilities: {},
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      encryptedCredentials: encryptedCreds,
      resultKeyHash: crypto.createHash('sha256').update('res-1').digest(),
      resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
      now: now.toISOString(),
    });

    // Replay attempt must throw OAuthTransactionReplayedError
    await expect(
      adapter.completeOAuthCallbackAtomic({
        transactionId: txId,
        stateHash,
        workspaceId: wsId1,
        platform: 'threads',
        actorUserId: userId,
        providerAccountId: 'user-replay',
        displayName: 'User Replay',
        handle: null,
        grantedScopes: [],
        capabilities: {},
        capabilitiesCheckedAt: now.toISOString(),
        tokenExpiresAt: null,
        environment: 'local',
        encryptedCredentials: encryptedCreds,
        resultKeyHash: crypto.createHash('sha256').update('res-2').digest(),
        resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
        now: now.toISOString(),
      }),
    ).rejects.toThrow(OAuthTransactionReplayedError);
  });

  it('fails closed when attempting to complete an expired transaction', async () => {
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

    const encryptedCreds = protector.encrypt({
      workspaceId: wsId1,
      socialAccountId: generateUuidV7(),
      platform: 'threads',
      accessToken: 'token-expired',
    });

    await expect(
      adapter.completeOAuthCallbackAtomic({
        transactionId: txId,
        stateHash,
        workspaceId: wsId1,
        platform: 'threads',
        actorUserId: userId,
        providerAccountId: 'user-exp',
        displayName: 'User Exp',
        handle: null,
        grantedScopes: [],
        capabilities: {},
        capabilitiesCheckedAt: new Date().toISOString(),
        tokenExpiresAt: null,
        environment: 'local',
        encryptedCredentials: encryptedCreds,
        resultKeyHash: crypto.createHash('sha256').update('res-exp').digest(),
        resultExpiresAt: new Date(Date.now() + 300000).toISOString(),
        now: new Date().toISOString(),
      }),
    ).rejects.toThrow(OAuthTransactionExpiredError);
  });

  it('converges concurrent duplicate connections for the same active provider account safely', async () => {
    const rawState1 = crypto.randomBytes(32).toString('base64url');
    const stateHash1 = crypto.createHash('sha256').update(rawState1, 'utf8').digest();
    const txId1 = generateUuidV7();

    const rawState2 = crypto.randomBytes(32).toString('base64url');
    const stateHash2 = crypto.createHash('sha256').update(rawState2, 'utf8').digest();
    const txId2 = generateUuidV7();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 600000);

    await adapter.saveOAuthTransaction({
      id: txId1,
      workspaceId: wsId1,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash: stateHash1,
      redirectUri: 'http://localhost:3001/callback',
      returnTo: '/',
      requestedScopes: [],
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
      requestedScopes: [],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    const encryptedCreds = protector.encrypt({
      workspaceId: wsId1,
      socialAccountId: generateUuidV7(),
      platform: 'threads',
      accessToken: 'token-converge',
    });

    // Complete transaction 1
    const res1 = await adapter.completeOAuthCallbackAtomic({
      transactionId: txId1,
      stateHash: stateHash1,
      workspaceId: wsId1,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'same_provider_acc_id',
      displayName: 'Creator Initial',
      handle: '@initial',
      grantedScopes: ['threads_basic'],
      capabilities: {},
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      encryptedCredentials: encryptedCreds,
      resultKeyHash: crypto.createHash('sha256').update('res-c1').digest(),
      resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
      now: now.toISOString(),
    });

    // Complete transaction 2 for the same provider account ID
    const res2 = await adapter.completeOAuthCallbackAtomic({
      transactionId: txId2,
      stateHash: stateHash2,
      workspaceId: wsId1,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'same_provider_acc_id',
      displayName: 'Creator Updated',
      handle: '@updated',
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilities: { canPublishText: true },
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      encryptedCredentials: encryptedCreds,
      resultKeyHash: crypto.createHash('sha256').update('res-c2').digest(),
      resultExpiresAt: new Date(now.getTime() + 300000).toISOString(),
      now: now.toISOString(),
    });

    // They must have updated the exact same account ID rather than creating a duplicate
    expect(res2.account.id).toBe(res1.account.id);
    expect(res2.account.displayName).toBe('Creator Updated');
    expect(res2.account.handle).toBe('@updated');
    expect(res2.account.version).toBe(res1.account.version + 1);

    // Verify there is strictly 1 active account in the database for this provider ID
    const countCheck = await pool.query(
      `SELECT count(*) FROM social_accounts WHERE workspace_id = $1 AND provider_account_id = $2`,
      [wsId1, 'same_provider_acc_id'],
    );
    expect(Number(countCheck.rows[0]?.count)).toBe(1);
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
      encryptedCredentials: protector.encrypt({
        workspaceId: wsId1,
        socialAccountId: generateUuidV7(),
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
      resultKeyHash,
      now: now.toISOString(),
    });
    expect(crossTenantConsume).toBeNull();
  });
});
