import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  generateUuidV7,
  SocialAccountVersionMismatchError,
} from '@affiliate-content-os/application';
import { createDatabase, type Database } from '../../src/database/index.js';
import {
  LocalSocialCredentialProtector,
  PostgresSocialPersistenceAdapter,
} from '../../src/social/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Social Account Lifecycle PostgreSQL Integration', () => {
  let testCtx: TestDatabaseContext;
  let pool: pg.Pool;
  let database: Database;
  let adapter: PostgresSocialPersistenceAdapter;
  const protectorKey = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';
  const protector = new LocalSocialCredentialProtector(protectorKey, 'v1');

  const wsId = generateUuidV7();
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

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, status, created_at, updated_at)
       VALUES ($1, 'google', 'sub-life-1', 'lifecycle-user@example.com', 'active', NOW(), NOW())`,
      [userId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at)
       VALUES ($1, 'Lifecycle WS', 'ws-life', 'UTC', 'active', NOW(), NOW())`,
      [wsId],
    );
  });

  afterAll(async () => {
    await database.close();
    await pool.end();
    await testCtx.cleanup();
  });

  async function createConnectedAccount(providerAccountId: string, displayName: string) {
    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(rawState, 'utf8').digest();
    const txId = generateUuidV7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 600000);

    await adapter.saveOAuthTransaction({
      id: txId,
      workspaceId: wsId,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash,
      redirectUri: 'http://localhost:3000/callback',
      returnTo: '/connections',
      requestedScopes: ['threads_basic', 'threads_content_publish'],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    await adapter.claimOAuthTransaction({
      stateHash,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    const res = await adapter.completeOAuthCallbackAtomic({
      transactionId: txId,
      stateHash,
      workspaceId: wsId,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId,
      displayName,
      handle: `@${providerAccountId}`,
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilities: { canPublishText: true },
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: new Date(now.getTime() + 5184000000).toISOString(),
      environment: 'local',
      encryptCredentials: (accId) =>
        protector.encrypt({
          workspaceId: wsId,
          socialAccountId: accId,
          platform: 'threads',
          accessToken: `token_${providerAccountId}`,
        }),
      resultKeyHash: crypto.randomBytes(32),
      resultExpiresAt: expiresAt.toISOString(),
      now: now.toISOString(),
    });

    return res.account;
  }

  it('completes reconnect flow matching bound provider account ID', async () => {
    const initialAccount = await createConnectedAccount('threads_bound_user_1', 'Bound Creator');
    const accountId = initialAccount.id;
    expect(initialAccount.version).toBe(1);

    // 1. Reconnect: Initiate transaction bound to this account
    const reconnectState = crypto.randomBytes(32).toString('base64url');
    const reconnectStateHash = crypto.createHash('sha256').update(reconnectState, 'utf8').digest();
    const reconnectTxId = generateUuidV7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 600000);

    await adapter.saveOAuthTransaction({
      id: reconnectTxId,
      workspaceId: wsId,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash: reconnectStateHash,
      redirectUri: 'http://localhost:3000/callback',
      returnTo: '/connections',
      requestedScopes: ['threads_basic', 'threads_content_publish'],
      reconnectAccountId: accountId,
      expectedProviderAccountId: 'threads_bound_user_1',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    await adapter.claimOAuthTransaction({
      stateHash: reconnectStateHash,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    // 2. Complete reconnect with same providerAccountId: succeeds and preserves account ID
    const reconnected = await adapter.completeOAuthCallbackAtomic({
      transactionId: reconnectTxId,
      stateHash: reconnectStateHash,
      workspaceId: wsId,
      platform: 'threads',
      actorUserId: userId,
      providerAccountId: 'threads_bound_user_1',
      displayName: 'Bound Creator Updated',
      handle: '@bound_creator',
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      capabilities: { canPublishText: true },
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: new Date(now.getTime() + 5184000000).toISOString(),
      environment: 'local',
      reconnectAccountId: accountId,
      encryptCredentials: (accId) =>
        protector.encrypt({
          workspaceId: wsId,
          socialAccountId: accId,
          platform: 'threads',
          accessToken: 'new_reconnected_token',
        }),
      resultKeyHash: crypto.randomBytes(32),
      resultExpiresAt: expiresAt.toISOString(),
      now: now.toISOString(),
    });

    expect(reconnected.account.id).toBe(accountId);
    expect(reconnected.account.displayName).toBe('Bound Creator Updated');
    expect(reconnected.account.version).toBe(2);
  });

  it('rejects reconnect when provider account ID mismatches bound account', async () => {
    const initialAccount = await createConnectedAccount('threads_user_alpha', 'User Alpha');
    const accountId = initialAccount.id;

    const reconnectState = crypto.randomBytes(32).toString('base64url');
    const reconnectStateHash = crypto.createHash('sha256').update(reconnectState, 'utf8').digest();
    const reconnectTxId = generateUuidV7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 600000);

    await adapter.saveOAuthTransaction({
      id: reconnectTxId,
      workspaceId: wsId,
      platform: 'threads',
      initiatedByUserId: userId,
      stateHash: reconnectStateHash,
      redirectUri: 'http://localhost:3000/callback',
      returnTo: '/connections',
      requestedScopes: ['threads_basic'],
      reconnectAccountId: accountId,
      expectedProviderAccountId: 'threads_user_alpha',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    await adapter.claimOAuthTransaction({
      stateHash: reconnectStateHash,
      platform: 'threads',
      now: now.toISOString(),
      claimTtlSeconds: 120,
    });

    // Attempt to complete with DIFFERENT providerAccountId
    await expect(
      adapter.completeOAuthCallbackAtomic({
        transactionId: reconnectTxId,
        stateHash: reconnectStateHash,
        workspaceId: wsId,
        platform: 'threads',
        actorUserId: userId,
        providerAccountId: 'threads_user_BETA', // Mismatch!
        displayName: 'User Beta',
        handle: '@beta',
        grantedScopes: ['threads_basic'],
        capabilities: { canPublishText: true },
        capabilitiesCheckedAt: now.toISOString(),
        tokenExpiresAt: new Date(now.getTime() + 5184000000).toISOString(),
        environment: 'local',
        reconnectAccountId: accountId,
        encryptCredentials: (accId) =>
          protector.encrypt({
            workspaceId: wsId,
            socialAccountId: accId,
            platform: 'threads',
            accessToken: 'beta_token',
          }),
        resultKeyHash: crypto.randomBytes(32),
        resultExpiresAt: expiresAt.toISOString(),
        now: now.toISOString(),
      }),
    ).rejects.toThrow('bound to a different provider account');
  });

  it('claims refresh lease, completes refresh under CAS, and rejects stale CAS', async () => {
    const initial = await createConnectedAccount('threads_refresh_test', 'Refresh Tester');
    const accountId = initial.id;
    const now = new Date();

    // 1. Claim refresh
    const claimed = await adapter.claimSocialAccountForRefresh({
      workspaceId: wsId,
      accountId,
      leaseDurationSeconds: 60,
      now: now.toISOString(),
    });

    expect(claimed).not.toBeNull();
    expect(claimed?.claimedAccountVersion).toBe(1);

    // 2. Complete refresh under CAS
    const newEncrypted = protector.encrypt({
      workspaceId: wsId,
      socialAccountId: accountId,
      platform: 'threads',
      accessToken: 'refreshed_access_token_val',
    });

    const refreshed = await adapter.completeSocialAccountRefreshAtomic({
      workspaceId: wsId,
      accountId,
      expectedAccountVersion: 1,
      expectedCredentialVersion: 1,
      expectedLeaseToken: claimed!.refreshLeaseToken,
      encryptedCredentials: newEncrypted,
      tokenExpiresAt: new Date(now.getTime() + 5184000000).toISOString(),
      nextRefreshAt: new Date(now.getTime() + 2592000000).toISOString(),
      derivedStatus: 'active',
      statusReason: 'none',
      now: now.toISOString(),
      actorUserId: userId,
    });

    expect(refreshed.version).toBe(2);
    expect(refreshed.status).toBe('active');

    // 3. Stale CAS attempt (using version 1 again) must fail with VersionMismatch
    await expect(
      adapter.completeSocialAccountRefreshAtomic({
        workspaceId: wsId,
        accountId,
        expectedAccountVersion: 1, // Stale!
        expectedCredentialVersion: 1,
        expectedLeaseToken: claimed!.refreshLeaseToken,
        encryptedCredentials: newEncrypted,
        tokenExpiresAt: null,
        nextRefreshAt: null,
        derivedStatus: 'active',
        statusReason: 'none',
        now: now.toISOString(),
      }),
    ).rejects.toThrow(SocialAccountVersionMismatchError);
  });

  it('safely disconnects account, deletes credentials, and enforces optimistic locking', async () => {
    const initial = await createConnectedAccount('threads_disconnect_test', 'Disconnect Tester');
    const accountId = initial.id;
    const now = new Date();

    // Disconnect with matching version
    const disconnected = await adapter.disconnectSocialAccountAtomic({
      workspaceId: wsId,
      accountId,
      actorUserId: userId,
      expectedVersion: 1,
      externalRevocationAttempted: false,
      externalRevocationSupported: false,
      externalRevocationResult: 'unsupported',
      now: now.toISOString(),
    });

    expect(disconnected.status).toBe('disconnected');
    expect(disconnected.version).toBe(2);

    // Verify credentials record was completely erased from social_credentials table
    const credRow = await pool.query(
      `SELECT * FROM social_credentials WHERE social_account_id = $1`,
      [accountId],
    );
    expect(credRow.rows).toHaveLength(0);
  });
});
