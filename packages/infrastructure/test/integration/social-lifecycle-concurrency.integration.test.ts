import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  IdempotencyKeyReusedError,
  SocialAccountVersionMismatchError,
  refreshSocialAccount,
  maintainDueSocialAccounts,
  disconnectSocialAccount,
  processDueSocialAccountRevocations,
  SocialAuthExchangeError,
  type SocialAuthAdapter,
} from '@affiliate-content-os/application';
import { createDatabase, type Database } from '../../src/database/index.js';
import {
  LocalSocialCredentialProtector,
  PostgresSocialPersistenceAdapter,
} from '../../src/social/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Social Lifecycle Concurrency & Barriers Integration', () => {
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
      poolMax: 10,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 30000,
      statementTimeoutMs: 15000,
      sslMode: 'disable',
    });
    adapter = new PostgresSocialPersistenceAdapter(database);

    await pool.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, status, created_at, updated_at)
       VALUES ($1, 'google', 'sub-life-conc-1', 'lifecycle-concurrency@example.com', 'active', NOW(), NOW())`,
      [userId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at)
       VALUES ($1, 'Lifecycle Concurrency WS', 'ws-life-conc', 'UTC', 'active', NOW(), NOW())`,
      [wsId],
    );
  });

  afterAll(async () => {
    await database.close();
    await pool.end();
    await testCtx.cleanup();
  });

  async function createTestAccount(providerAccountId: string, displayName: string) {
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

  it('barrier concurrency: two simultaneous refresh claims yield exactly one winner', async () => {
    const account = await createTestAccount('threads_conc_claim', 'Concurrent Claimant');
    const now = new Date().toISOString();

    // Launch two simultaneous claims with different workers
    const [claimA, claimB] = await Promise.all([
      adapter.claimSocialAccountForRefresh({
        workspaceId: wsId,
        accountId: account.id,
        workerId: 'worker-A',
        leaseDurationSeconds: 60,
        now,
      }),
      adapter.claimSocialAccountForRefresh({
        workspaceId: wsId,
        accountId: account.id,
        workerId: 'worker-B',
        leaseDurationSeconds: 60,
        now,
      }),
    ]);

    const winner = claimA ?? claimB;
    const loser = claimA ? claimB : claimA;

    expect(winner).not.toBeNull();
    expect(loser).toBeNull();
    expect(winner?.refreshLeaseToken).toBeDefined();
  });

  it('reclaims expired lease after leaseDurationSeconds passes', async () => {
    const account = await createTestAccount('threads_lease_expire', 'Lease Expire Claimant');
    const t0 = new Date('2026-11-20T00:00:00.000Z');

    // Worker 1 claims with 5 second lease
    const claim1 = await adapter.claimSocialAccountForRefresh({
      workspaceId: wsId,
      accountId: account.id,
      workerId: 'worker-1',
      leaseDurationSeconds: 5,
      now: t0.toISOString(),
    });
    expect(claim1).not.toBeNull();

    // Worker 2 attempts claim while lease is active: blocked (null)
    const activeAttempt = await adapter.claimSocialAccountForRefresh({
      workspaceId: wsId,
      accountId: account.id,
      workerId: 'worker-2',
      leaseDurationSeconds: 60,
      now: new Date('2026-11-20T00:00:03.000Z').toISOString(),
    });
    expect(activeAttempt).toBeNull();

    // Worker 2 attempts claim after lease has expired (at +10s): succeeds
    const expiredAttempt = await adapter.claimSocialAccountForRefresh({
      workspaceId: wsId,
      accountId: account.id,
      workerId: 'worker-2',
      leaseDurationSeconds: 60,
      now: new Date('2026-11-20T00:00:10.000Z').toISOString(),
    });
    expect(expiredAttempt).not.toBeNull();
    expect(expiredAttempt?.refreshLeaseToken).not.toBe(claim1?.refreshLeaseToken);
  });

  it('old claim token cannot complete a newer reclaimed lease', async () => {
    const account = await createTestAccount('threads_stale_token', 'Stale Token Claimant');
    const t0 = new Date();

    // Worker 1 claims
    const claim1 = await adapter.claimSocialAccountForRefresh({
      workspaceId: wsId,
      accountId: account.id,
      workerId: 'worker-1',
      leaseDurationSeconds: 2,
      now: t0.toISOString(),
    });
    expect(claim1).not.toBeNull();

    // Lease expires and Worker 2 claims
    const tExpired = new Date(t0.getTime() + 5000);
    const claim2 = await adapter.claimSocialAccountForRefresh({
      workspaceId: wsId,
      accountId: account.id,
      workerId: 'worker-2',
      leaseDurationSeconds: 60,
      now: tExpired.toISOString(),
    });
    expect(claim2).not.toBeNull();

    // Worker 1 tries to complete with stale claim1 token: MUST FAIL
    const newCreds = protector.encrypt({
      workspaceId: wsId,
      socialAccountId: account.id,
      platform: 'threads',
      accessToken: 'stale_worker1_token',
    });

    const tComplete = new Date(t0.getTime() + 6000);
    await expect(
      adapter.completeSocialAccountRefreshAtomic({
        workspaceId: wsId,
        accountId: account.id,
        expectedAccountVersion: claim1!.claimedAccountVersion,
        expectedCredentialVersion: claim1!.claimedCredentialVersion,
        expectedLeaseToken: claim1!.refreshLeaseToken,
        encryptedCredentials: newCreds,
        tokenExpiresAt: null,
        nextRefreshAt: null,
        derivedStatus: 'active',
        statusReason: 'none',
        now: tComplete.toISOString(),
      }),
    ).rejects.toThrow(SocialAccountVersionMismatchError);

    // Worker 2 completes with valid claim2 token: SUCCEEDS
    const completed = await adapter.completeSocialAccountRefreshAtomic({
      workspaceId: wsId,
      accountId: account.id,
      expectedAccountVersion: claim2!.claimedAccountVersion,
      expectedCredentialVersion: claim2!.claimedCredentialVersion,
      expectedLeaseToken: claim2!.refreshLeaseToken,
      encryptedCredentials: newCreds,
      tokenExpiresAt: null,
      nextRefreshAt: null,
      derivedStatus: 'active',
      statusReason: 'none',
      now: tComplete.toISOString(),
    });
    expect(completed.version).toBe(claim2!.claimedAccountVersion + 1);
  });

  it('disconnect during refresh wins and stale refresh CAS cannot reactivate', async () => {
    const account = await createTestAccount('threads_disconnect_race', 'Disconnect Racer');
    const now = new Date().toISOString();

    // Worker claims refresh
    const claimed = await adapter.claimSocialAccountForRefresh({
      workspaceId: wsId,
      accountId: account.id,
      workerId: 'worker-refresh',
      leaseDurationSeconds: 60,
      now,
    });
    expect(claimed).not.toBeNull();

    // User disconnects while refresh is in flight
    const disconnected = await adapter.disconnectSocialAccountAtomic({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      expectedVersion: claimed!.claimedAccountVersion,
      externalRevocationAttempted: false,
      externalRevocationSupported: false,
      externalRevocationResult: 'unsupported',
      now,
    });
    expect(disconnected.status).toBe('disconnected');

    // In-flight refresh completes: MUST FAIL because account is disconnected
    const newCreds = protector.encrypt({
      workspaceId: wsId,
      socialAccountId: account.id,
      platform: 'threads',
      accessToken: 'refreshed_after_disconnect',
    });

    await expect(
      adapter.completeSocialAccountRefreshAtomic({
        workspaceId: wsId,
        accountId: account.id,
        expectedAccountVersion: claimed!.claimedAccountVersion,
        expectedCredentialVersion: claimed!.claimedCredentialVersion,
        expectedLeaseToken: claimed!.refreshLeaseToken,
        encryptedCredentials: newCreds,
        tokenExpiresAt: null,
        nextRefreshAt: null,
        derivedStatus: 'active',
        statusReason: 'none',
        now,
      }),
    ).rejects.toThrow(SocialAccountVersionMismatchError);

    // Confirm DB account is still disconnected and credentials remain deleted
    const checkAcc = await adapter.findSocialAccountById({
      workspaceId: wsId,
      accountId: account.id,
    });
    expect(checkAcc?.status).toBe('disconnected');
    const credRows = await pool.query(
      `SELECT * FROM social_credentials WHERE social_account_id = $1`,
      [account.id],
    );
    expect(credRows.rows).toHaveLength(0);
  });

  it('due-work selector with FOR UPDATE SKIP LOCKED does not double-claim across two workers', async () => {
    const acc1 = await createTestAccount('threads_due_1', 'Due User 1');
    const acc2 = await createTestAccount('threads_due_2', 'Due User 2');
    const past = new Date('2026-11-19T00:00:00.000Z').toISOString();
    const now = new Date('2026-11-20T00:00:00.000Z').toISOString();

    // Mark both accounts as due for refresh
    await pool.query(`UPDATE social_accounts SET next_refresh_at = $1 WHERE id IN ($2, $3)`, [
      past,
      acc1.id,
      acc2.id,
    ]);

    // Two workers pull due accounts simultaneously
    const [claimed1, claimed2] = await Promise.all([
      adapter.claimNextDueSocialAccountForRefresh({
        now,
        workerId: 'due-worker-1',
        leaseDurationSeconds: 60,
        claimToken: generateUuidV7(),
      }),
      adapter.claimNextDueSocialAccountForRefresh({
        now,
        workerId: 'due-worker-2',
        leaseDurationSeconds: 60,
        claimToken: generateUuidV7(),
      }),
    ]);

    expect(claimed1).not.toBeNull();
    expect(claimed2).not.toBeNull();
    // They must have claimed different accounts!
    expect(claimed1?.account.id).not.toBe(claimed2?.account.id);
    const claimedIds = new Set([claimed1?.account.id, claimed2?.account.id]);
    expect(claimedIds.has(acc1.id)).toBe(true);
    expect(claimedIds.has(acc2.id)).toBe(true);
  });

  it('idempotency: replay returns exact cached response without re-mutating; hash mismatch fails 409', async () => {
    const account = await createTestAccount('threads_idemp_test', 'Idemp Tester');
    const idempotencyKey = generateUuidV7();
    const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest();
    const requestHash1 = crypto
      .createHash('sha256')
      .update(JSON.stringify({ action: 'refresh', v: 1 }))
      .digest();
    const requestHash2 = crypto
      .createHash('sha256')
      .update(JSON.stringify({ action: 'refresh', v: 2 }))
      .digest();
    const routeKey = `POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/refresh`;
    const now = new Date().toISOString();

    let mutationExecutionCount = 0;
    const executeMutation = async () => {
      mutationExecutionCount++;
      // Real database mutation: update social_accounts version
      await pool.query(
        `UPDATE social_accounts SET version = version + 1, updated_at = NOW() WHERE id = $1`,
        [account.id],
      );
      const updated = await adapter.findSocialAccountById({
        workspaceId: wsId,
        accountId: account.id,
      });
      return updated!;
    };

    // First call: executes mutation
    const call1 = await adapter.executeMutationWithIdempotency({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      idempotency: {
        idempotencyKey,
        keyHash,
        requestHash: requestHash1,
        routeKey,
      },
      now,
      executeMutation,
    });

    expect(call1.status).toBe('completed');
    if (call1.status !== 'completed') throw new Error('Expected completed');
    expect(call1.replayed).toBe(false);
    expect(call1.account.version).toBe(account.version + 1);
    expect(mutationExecutionCount).toBe(1);

    // Second call with same idempotency key and SAME requestHash: returns cached response without running mutation
    const call2 = await adapter.executeMutationWithIdempotency({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      idempotency: {
        idempotencyKey,
        keyHash,
        requestHash: requestHash1,
        routeKey,
      },
      now,
      executeMutation,
    });

    expect(call2.status).toBe('completed');
    if (call2.status !== 'completed') throw new Error('Expected completed');
    expect(call2.replayed).toBe(true);
    expect(call2.account.version).toBe(call1.account.version);
    expect(mutationExecutionCount).toBe(1); // Mutation was NOT run again!

    // Third call with same idempotency key but DIFFERENT requestHash: throws IdempotencyKeyReusedError (HTTP 409)
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: {
          idempotencyKey,
          keyHash,
          requestHash: requestHash2, // Mismatched!
          routeKey,
        },
        now,
        executeMutation,
      }),
    ).rejects.toThrow(IdempotencyKeyReusedError);
  });

  it('failure injection: crash after mutation commit before response completion reloads authoritative state on replay without re-mutating', async () => {
    const account = await createTestAccount('threads_crash_test', 'Crash Tester');
    const idempotencyKey = generateUuidV7();
    const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest();
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ action: 'crash_test' }))
      .digest();
    const routeKey = `POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/refresh`;
    const now = new Date().toISOString();

    let attempts = 0;
    const executeMutation = async (claimedOp?: { operationId: string; leaseToken: string }) => {
      attempts++;
      // Real database mutation committing version increment and marking operation completed
      await pool.query(
        `UPDATE social_accounts SET version = version + 1, updated_at = NOW() WHERE id = $1`,
        [account.id],
      );
      if (claimedOp) {
        await pool.query(
          `UPDATE social_account_operations
           SET status = 'completed', phase = 'terminal', resource_version = $2, completed_at = NOW()
           WHERE id = $1`,
          [claimedOp.operationId, account.version + 1],
        );
      }
      // Simulate crash right after mutation commit
      if (attempts === 1) {
        throw new Error('SIMULATED_PROCESS_CRASH_AFTER_COMMIT');
      }
      const updated = await adapter.findSocialAccountById({
        workspaceId: wsId,
        accountId: account.id,
      });
      return updated!;
    };

    // First attempt crashes after mutation has committed to DB
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: {
          idempotencyKey,
          keyHash,
          requestHash,
          routeKey,
        },
        now,
        executeMutation,
      }),
    ).rejects.toThrow('SIMULATED_PROCESS_CRASH_AFTER_COMMIT');

    expect(attempts).toBe(1);

    // Second attempt (replay) with same key: recovers authoritative state without re-running executeMutation
    const replayed = await adapter.executeMutationWithIdempotency({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      idempotency: {
        idempotencyKey,
        keyHash,
        requestHash,
        routeKey,
      },
      now,
      executeMutation,
    });

    expect(replayed.status).toBe('completed');
    if (replayed.status !== 'completed') throw new Error('Expected completed');
    expect(replayed.replayed).toBe(true);
    expect(replayed.account.version).toBe(account.version + 1);
    expect(attempts).toBe(1); // executeMutation was NOT called again!
  });

  it('barrier evidence: two concurrent refresh use-case calls share one account -> assert provider call counter is exactly 1', async () => {
    const account = await createTestAccount('threads_barrier_conc', 'Barrier Concurrent');
    const past = new Date(Date.now() - 3600000).toISOString();
    await pool.query(
      `UPDATE social_credentials SET earliest_refresh_at = $1 WHERE social_account_id = $2`,
      [past, account.id],
    );
    let providerCalls = 0;

    const mockAdapter: SocialAuthAdapter = {
      platform: 'threads',
      supportsRefresh: true,
      supportsRevocation: false,
      createAuthorizationUrl: async () => ({ authorizationUrl: 'http://localhost' }),
      exchangeCode: async () => {
        throw new Error('Not implemented');
      },
      refreshToken: async () => {
        providerCalls++;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          accessToken: 'rotated_token_barrier_123',
          tokenKind: 'long_lived' as const,
          tokenExpiresInSeconds: 5184000,
        };
      },
      inspectCurrentAccount: async () => ({
        providerAccountId: account.providerAccountId,
        handle: account.handle,
        displayName: account.displayName,
        grantedScopes: ['threads_basic', 'threads_content_publish'],
        capabilities: { canPublishText: true },
      }),
    };

    const deps = {
      persistence: adapter,
      protector,
      adapters: new Map<SocialPlatform, SocialAuthAdapter>([['threads', mockAdapter]]),
      enabled: true,
      clock: { now: () => new Date() },
    };

    // Launch two simultaneous application-level refresh calls
    const [resA, resB] = await Promise.all([
      refreshSocialAccount({ workspaceId: wsId, accountId: account.id, actorUserId: userId }, deps),
      refreshSocialAccount({ workspaceId: wsId, accountId: account.id, actorUserId: userId }, deps),
    ]);

    // Exactly one winner refreshed, exactly one loser received unrefreshed snapshot
    const refreshedCount = (resA.refreshed ? 1 : 0) + (resB.refreshed ? 1 : 0);
    expect(refreshedCount).toBe(1);

    // CRITICAL BARRIER EVIDENCE: Exactly ONE provider call was made!
    expect(providerCalls).toBe(1);
  });

  it('maintenance execution: due claim -> exactly one provider call -> fenced rotation; two workers do not double-call; failure records state; no due work returns zero', async () => {
    // 1. Account is due for refresh
    const dueAccount = await createTestAccount('threads_due_maint', 'Due Maintenance');
    const past = new Date(Date.now() - 3600000).toISOString();
    await pool.query(
      `UPDATE social_accounts SET next_refresh_at = NOW() + INTERVAL '10 days', refresh_lease_expires_at = NULL WHERE id <> $1`,
      [dueAccount.id],
    );
    await pool.query(`UPDATE social_accounts SET next_refresh_at = $1 WHERE id = $2`, [
      past,
      dueAccount.id,
    ]);
    await pool.query(
      `UPDATE social_credentials SET earliest_refresh_at = $1 WHERE social_account_id = $2`,
      [past, dueAccount.id],
    );

    let providerCalls = 0;
    const mockAdapter: SocialAuthAdapter = {
      platform: 'threads',
      supportsRefresh: true,
      supportsRevocation: false,
      createAuthorizationUrl: async () => ({ authorizationUrl: 'http://localhost' }),
      exchangeCode: async () => {
        throw new Error('Not implemented');
      },
      refreshToken: async () => {
        providerCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          accessToken: 'rotated_token_maint_456',
          tokenKind: 'long_lived' as const,
          tokenExpiresInSeconds: 5184000,
        };
      },
      inspectCurrentAccount: async () => ({
        providerAccountId: dueAccount.providerAccountId,
        handle: dueAccount.handle,
        displayName: dueAccount.displayName,
        grantedScopes: ['threads_basic', 'threads_content_publish'],
        capabilities: { canPublishText: true },
      }),
    };

    const deps = {
      persistence: adapter,
      protector,
      adapters: new Map<SocialPlatform, SocialAuthAdapter>([['threads', mockAdapter]]),
      enabled: true,
      clock: { now: () => new Date() },
    };

    // Two workers attempt to maintain due work simultaneously
    const [resWorker1, resWorker2] = await Promise.all([
      maintainDueSocialAccounts({ workerId: 'worker-1', maxBatchSize: 1 }, deps),
      maintainDueSocialAccounts({ workerId: 'worker-2', maxBatchSize: 1 }, deps),
    ]);

    // Total processed across both workers must be 1, not 2
    expect(resWorker1.processedCount + resWorker2.processedCount).toBe(1);
    expect(resWorker1.claimedCount + resWorker2.claimedCount).toBe(1);
    expect(resWorker1.refreshedCount + resWorker2.refreshedCount).toBe(1);
    expect(providerCalls).toBe(1);

    // 2. Failure records state and releases claim safely
    const failAccount = await createTestAccount('threads_fail_maint', 'Fail Maintenance');
    await pool.query(`UPDATE social_accounts SET next_refresh_at = $1 WHERE id = $2`, [
      past,
      failAccount.id,
    ]);
    await pool.query(
      `UPDATE social_credentials SET earliest_refresh_at = $1 WHERE social_account_id = $2`,
      [past, failAccount.id],
    );

    const failingAdapter: SocialAuthAdapter = {
      platform: 'threads',
      supportsRefresh: true,
      supportsRevocation: false,
      createAuthorizationUrl: async () => ({ authorizationUrl: 'http://localhost' }),
      exchangeCode: async () => {
        throw new Error('Not implemented');
      },
      refreshToken: async () => {
        throw new SocialAuthExchangeError('Provider unavailable');
      },
    };

    const failDeps = {
      ...deps,
      adapters: new Map<SocialPlatform, SocialAuthAdapter>([['threads', failingAdapter]]),
    };

    const failRes = await maintainDueSocialAccounts(
      { workerId: 'worker-fail', maxBatchSize: 1 },
      failDeps,
    );

    expect(failRes.processedCount).toBe(1);
    expect(failRes.failedCount).toBe(1);

    // 3. No due work returns zero
    const emptyRes = await maintainDueSocialAccounts(
      { workerId: 'worker-empty', maxBatchSize: 10 },
      deps,
    );
    expect(emptyRes.processedCount).toBe(0);
    expect(emptyRes.claimedCount).toBe(0);
    expect(emptyRes.refreshedCount).toBe(0);
    expect(emptyRes.failedCount).toBe(0);
  });

  it('disconnect barrier: remote revocation blocked on barrier proves account is already disconnected and credentials deleted; release updates result', async () => {
    const account = await createTestAccount('threads_barrier_disc', 'Barrier Disconnect');

    let barrierRelease: () => void = () => {};
    const barrierPromise = new Promise<void>((resolve) => {
      barrierRelease = resolve;
    });

    const mockAdapter: SocialAuthAdapter = {
      platform: 'threads',
      supportsRefresh: false,
      supportsRevocation: true, // Supports revocation
      createAuthorizationUrl: async () => ({ authorizationUrl: 'http://localhost' }),
      exchangeCode: async () => {
        throw new Error('Not implemented');
      },
      revokeToken: async () => {
        // Block until test signals barrier
        await barrierPromise;
        return { supported: true, revoked: true };
      },
    };

    const deps = {
      persistence: adapter,
      protector,
      adapters: new Map<SocialPlatform, SocialAuthAdapter>([['threads', mockAdapter]]),
      enabled: true,
      clock: { now: () => new Date() },
    };

    // 1. Immediate local disconnect: does not wait for remote revocation
    const disconnectResult = await disconnectSocialAccount(
      {
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        expectedVersion: account.version,
      },
      deps,
    );

    expect(disconnectResult.account.status).toBe('disconnected');
    expect(disconnectResult.account.externalRevocationResult).toBe('pending');

    // 2. Credentials are ALREADY deleted locally
    const credRows = await pool.query(
      `SELECT * FROM social_credentials WHERE social_account_id = $1`,
      [account.id],
    );
    expect(credRows.rows).toHaveLength(0);

    // 3. Revocation job is staged in social_account_revocations
    const stagedJobs = await pool.query(
      `SELECT status, phase, encrypted_token FROM social_account_revocations WHERE social_account_id = $1`,
      [account.id],
    );
    expect(stagedJobs.rows).toHaveLength(1);
    expect(stagedJobs.rows[0]?.status).toBe('pending');
    expect(stagedJobs.rows[0]?.phase).toBe('claimed');
    expect(stagedJobs.rows[0]?.encrypted_token).not.toBeNull();

    // 4. Asynchronous worker processes the staged revocation
    const workerTask = processDueSocialAccountRevocations(
      { workerId: 'worker-revocations', maxBatchSize: 1 },
      deps,
    );

    // Brief delay to ensure worker entered revokeToken barrier
    await new Promise((r) => setTimeout(r, 50));

    // Release barrier to allow worker to complete provider call
    barrierRelease();
    const workerResult = await workerTask;

    expect(workerResult.processedCount).toBe(1);
    expect(workerResult.succeededCount).toBe(1);

    // 5. Account in DB has updated to 'succeeded'
    const finalAccount = await adapter.findSocialAccountById({
      workspaceId: wsId,
      accountId: account.id,
    });
    expect(finalAccount?.externalRevocationResult).toBe('succeeded');

    // 6. Encrypted token material is wiped upon completion
    const completedJob = await pool.query(
      `SELECT status, phase, encrypted_token FROM social_account_revocations WHERE social_account_id = $1`,
      [account.id],
    );
    expect(completedJob.rows[0]?.status).toBe('succeeded');
    expect(completedJob.rows[0]?.phase).toBe('terminal');
    expect(completedJob.rows[0]?.encrypted_token.length).toBe(0);
  });

  it('eligibility: earliest_refresh_at in the future rejected by claim SQL for both manual and due maintenance', async () => {
    const account = await createTestAccount('threads_future_elig', 'Future Eligibility');
    const future = new Date(Date.now() + 3600000).toISOString();
    const past = new Date(Date.now() - 3600000).toISOString();
    const now = new Date().toISOString();

    // Ensure no other accounts in the DB are due
    await pool.query(
      `UPDATE social_accounts SET next_refresh_at = NOW() + INTERVAL '10 days', refresh_lease_expires_at = NULL WHERE id <> $1`,
      [account.id],
    );

    // 1. Set earliest_refresh_at to future, next_refresh_at to past (due)
    await pool.query(
      `UPDATE social_credentials SET earliest_refresh_at = $1 WHERE social_account_id = $2`,
      [future, account.id],
    );
    await pool.query(`UPDATE social_accounts SET next_refresh_at = $1 WHERE id = $2`, [
      past,
      account.id,
    ]);

    // Manual claim MUST FAIL because earliest_refresh_at is in the future
    const manualClaim = await adapter.claimSocialAccountForRefresh({
      workspaceId: wsId,
      accountId: account.id,
      workerId: 'worker-elig',
      leaseDurationSeconds: 60,
      now,
    });
    expect(manualClaim).toBeNull();

    // Due claim MUST FAIL because earliest_refresh_at is in the future
    const dueClaim = await adapter.claimNextDueSocialAccountForRefresh({
      now,
      workerId: 'worker-elig',
      leaseDurationSeconds: 60,
      claimToken: generateUuidV7(),
    });
    expect(dueClaim).toBeNull();

    // 2. Advance earliest_refresh_at to past
    await pool.query(
      `UPDATE social_credentials SET earliest_refresh_at = $1 WHERE social_account_id = $2`,
      [past, account.id],
    );

    // Now due claim succeeds!
    const validDueClaim = await adapter.claimNextDueSocialAccountForRefresh({
      now,
      workerId: 'worker-elig',
      leaseDurationSeconds: 60,
      claimToken: generateUuidV7(),
    });
    expect(validDueClaim).not.toBeNull();
    expect(validDueClaim?.account.id).toBe(account.id);
  });

  it('partial callback persists truthful partial status and non-success audit event', async () => {
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
      providerAccountId: 'threads_partial_user',
      displayName: 'Partial User',
      handle: '@partial_user',
      grantedScopes: ['threads_basic'],
      capabilities: {},
      capabilitiesCheckedAt: now.toISOString(),
      tokenExpiresAt: null,
      environment: 'local',
      derivedStatus: 'degraded',
      statusReason: 'missing_grants',
      callbackStatus: 'partial',
      callbackErrorCode: 'partial_exchange',
      callbackErrorDescription: 'Partial exchange occurred.',
      encryptCredentials: (accId) =>
        protector.encrypt({
          workspaceId: wsId,
          socialAccountId: accId,
          platform: 'threads',
          accessToken: 'partial_token',
        }),
      resultKeyHash: crypto.randomBytes(32),
      resultExpiresAt: expiresAt.toISOString(),
      now: now.toISOString(),
    });

    expect(res.account.status).toBe('degraded');
    expect(res.account.statusReason).toBe('missing_grants');
    expect(res.callbackResult.status).toBe('partial');
    expect(res.callbackResult.errorCode).toBe('partial_exchange');

    // Verify persisted DB row in oauth_callback_results
    const row = await pool.query(
      `SELECT status, error_code FROM oauth_callback_results WHERE id = $1`,
      [res.callbackResult.id],
    );
    expect(row.rows[0]?.status).toBe('partial');
    expect(row.rows[0]?.error_code).toBe('partial_exchange');

    // Verify audit event persisted with result = 'failed' and reason_code = 'partial_exchange'
    const auditRes = await pool.query(
      `SELECT result, reason_code FROM audit_events WHERE resource_id = $1 AND action = 'social_connection.completed'`,
      [res.account.id],
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
    expect(auditRes.rows[0]?.result).toBe('failed');
    expect(auditRes.rows[0]?.reason_code).toBe('partial_exchange');
  });
});
