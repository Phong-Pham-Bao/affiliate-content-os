import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import {
  generateUuidV7,
  disconnectSocialAccount,
  processDueSocialAccountRevocations,
  SocialAuthOutcomeUnknownError,
  type SocialAuthAdapter,
} from '@affiliate-content-os/application';
import { createDatabase, type Database } from '../../src/database/index.js';
import {
  LocalSocialCredentialProtector,
  PostgresSocialPersistenceAdapter,
} from '../../src/social/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('TASK-017 Remediation 03 Fencing & Lifecycle Guarantees', () => {
  let testCtx: TestDatabaseContext;
  let pool: pg.Pool;
  let database: Database;
  let adapter: PostgresSocialPersistenceAdapter;
  const protectorKey = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';
  const protector = new LocalSocialCredentialProtector(protectorKey, 'v1');

  const wsId = generateUuidV7();
  const otherWsId = generateUuidV7();
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
       VALUES ($1, 'google', 'sub-rem-03-1', 'rem03@example.com', 'active', NOW(), NOW())`,
      [userId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at)
       VALUES ($1, 'Remediation 03 WS', 'ws-rem-03', 'UTC', 'active', NOW(), NOW()),
              ($2, 'Other WS', 'ws-rem-03-other', 'UTC', 'active', NOW(), NOW())`,
      [wsId, otherWsId],
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
      derivedStatus: 'active',
      statusReason: 'initial_exchange_complete',
      callbackStatus: 'success',
      callbackErrorCode: null,
      callbackErrorDescription: null,
      encryptCredentials: (accId) =>
        protector.encrypt({
          workspaceId: wsId,
          socialAccountId: accId,
          platform: 'threads',
          accessToken: `access_token_${providerAccountId}`,
        }),
      resultKeyHash: crypto.randomBytes(32),
      resultExpiresAt: expiresAt.toISOString(),
      now: now.toISOString(),
    });

    return res.account;
  }

  it('Migration 0018 enforces composite tenant FK preventing cross-workspace operation linkage', async () => {
    const account = await createTestAccount('threads_fk_test', 'FK Account');
    const opId = generateUuidV7();
    const leaseToken = generateUuidV7();
    const keyHash = crypto.randomBytes(32);
    const reqHash = crypto.randomBytes(32);

    // Attempt to insert operation linking otherWsId to account belonging to wsId: MUST FAIL
    await expect(
      pool.query(
        `INSERT INTO social_account_operations (
           id, workspace_id, social_account_id, principal_id, route_key,
           key_hash, request_hash, operation_type, status, phase, lease_token,
           lease_expires_at, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, 'POST /test', $5, $6, 'refresh', 'pending', 'claimed', $7, NOW() + interval '60 seconds', NOW(), NOW() + interval '1 day')`,
        [opId, otherWsId, account.id, userId, keyHash, reqHash, leaseToken],
      ),
    ).rejects.toThrow();

    // With matching wsId, it SUCCEEDS
    const validOpId = generateUuidV7();
    await pool.query(
      `INSERT INTO social_account_operations (
         id, workspace_id, social_account_id, principal_id, route_key,
         key_hash, request_hash, operation_type, status, phase, lease_token,
         lease_expires_at, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, 'POST /test', $5, $6, 'refresh', 'pending', 'claimed', $7, NOW() + interval '60 seconds', NOW(), NOW() + interval '1 day')`,
      [validOpId, wsId, account.id, userId, keyHash, reqHash, leaseToken],
    );
  });

  it('Migration 0018 enforces composite tenant FK preventing cross-workspace revocation linkage', async () => {
    const account = await createTestAccount('threads_rev_fk_test', 'Rev FK Account');
    const revId = generateUuidV7();

    // Cross-workspace insertion fails
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, created_at, updated_at
         ) VALUES ($1, $2, $3, 'threads', '\\x01', '\\x02', '\\x03', 'v1', 'pending', 'claimed', NOW(), NOW())`,
        [revId, otherWsId, account.id],
      ),
    ).rejects.toThrow();
  });

  it('Migration 0018 check constraints enforce valid phase, status, and clean error codes', async () => {
    const account = await createTestAccount('threads_chk_test', 'Check Account');
    const opId = generateUuidV7();
    const leaseToken = generateUuidV7();
    const keyHash = crypto.randomBytes(32);
    const reqHash = crypto.randomBytes(32);

    // Invalid phase/status combination: terminal phase but pending status must fail
    await expect(
      pool.query(
        `INSERT INTO social_account_operations (
           id, workspace_id, social_account_id, principal_id, route_key,
           key_hash, request_hash, operation_type, status, phase, lease_token,
           lease_expires_at, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, 'POST /test', $5, $6, 'refresh', 'pending', 'terminal', $7, NOW() + interval '60 seconds', NOW(), NOW() + interval '1 day')`,
        [opId, wsId, account.id, userId, keyHash, reqHash, leaseToken],
      ),
    ).rejects.toThrow();

    // Invalid error code with control characters must fail check constraint
    await expect(
      pool.query(
        `INSERT INTO social_account_operations (
           id, workspace_id, social_account_id, principal_id, route_key,
           key_hash, request_hash, operation_type, status, phase, error_code,
           completed_at, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, 'POST /test', $5, $6, 'refresh', 'failed', 'terminal', 'ERR\tCODE', NOW(), NOW(), NOW() + interval '1 day')`,
        [opId, wsId, account.id, userId, keyHash, reqHash],
      ),
    ).rejects.toThrow();
  });

  it('Concurrent in-flight idempotency request returns 202 in_progress with Retry-After and converges on completion', async () => {
    const account = await createTestAccount('threads_inflight_test', 'InFlight Account');
    const idempotencyKey = generateUuidV7();
    const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest();
    const requestHash = crypto.createHash('sha256').update('req-body').digest();
    const routeKey = 'POST /refresh';

    let barrierRelease: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      barrierRelease = resolve;
    });

    let markWinnerStarted: () => void = () => {};
    const winnerStartedPromise = new Promise<void>((resolve) => {
      markWinnerStarted = resolve;
    });

    // Winner starts mutation and blocks
    const winnerTask = adapter.executeMutationWithIdempotency({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
      leaseDurationSeconds: 180,
      executeMutation: async (claimed) => {
        markWinnerStarted();
        await barrier;
        // Mark operation attempt started
        await adapter.markOperationAttemptStarted({
          operationId: claimed!.operationId,
          leaseToken: claimed!.leaseToken,
        });
        // Complete mutation
        await pool.query(
          `UPDATE social_accounts SET version = version + 1, display_name = 'Winner Completed', updated_at = NOW() WHERE id = $1`,
          [account.id],
        );
        const updated = await adapter.findSocialAccountById({
          workspaceId: wsId,
          accountId: account.id,
        });
        return updated!;
      },
    });

    // Wait until winner has acquired the lease and entered execution
    await winnerStartedPromise;

    // Concurrent loser with exact same key makes request
    const loserResult = await adapter.executeMutationWithIdempotency({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
      leaseDurationSeconds: 180,
      executeMutation: async () => {
        throw new Error('Should not execute');
      },
    });

    // Loser receives truthful 202 in_progress response with Retry-After
    expect(loserResult.status).toBe('in_progress');
    if (loserResult.status === 'in_progress') {
      expect(loserResult.retryAfterSeconds).toBe(2);
    }

    // Release winner barrier
    barrierRelease();
    const winnerResult = await winnerTask;
    expect(winnerResult.status).toBe('completed');
    if (winnerResult.status === 'completed') {
      expect(winnerResult.replayed).toBe(false);
      expect(winnerResult.account.displayName).toBe('Winner Completed');
    }

    // Subsequent replay converges to completed authoritative snapshot
    const replayResult = await adapter.executeMutationWithIdempotency({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
      executeMutation: async () => {
        throw new Error('Should not re-execute');
      },
    });
    expect(replayResult.status).toBe('completed');
    if (replayResult.status === 'completed') {
      expect(replayResult.replayed).toBe(true);
      expect(replayResult.account.displayName).toBe('Winner Completed');
    }
  });

  it('Derived lease exceeding 120s fences the entire sequence against premature reclamation', async () => {
    const account = await createTestAccount('threads_long_lease', 'Long Lease Account');
    const opId = generateUuidV7();
    const leaseToken = generateUuidV7();
    const keyHash = crypto.randomBytes(32);
    const reqHash = crypto.randomBytes(32);

    // Derived 180s lease
    await pool.query(
      `INSERT INTO social_account_operations (
         id, workspace_id, social_account_id, principal_id, route_key,
         key_hash, request_hash, operation_type, status, phase, lease_token,
         lease_expires_at, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, 'POST /refresh', $5, $6, 'refresh', 'pending', 'claimed', $7, NOW() + interval '180 seconds', NOW(), NOW() + interval '1 day')`,
      [opId, wsId, account.id, userId, keyHash, reqHash, leaseToken],
    );

    // At 130s elapsed (beyond old 120s fixed lease), lease is NOT expired
    const checkActive = await pool.query(
      `SELECT id FROM social_account_operations
       WHERE id = $1 AND status = 'pending' AND lease_expires_at <= NOW() + interval '130 seconds'`,
      [opId],
    );
    expect(checkActive.rows).toHaveLength(0);

    // At 190s elapsed, lease is expired
    const checkExpired = await pool.query(
      `SELECT id FROM social_account_operations
       WHERE id = $1 AND status = 'pending' AND lease_expires_at <= NOW() + interval '190 seconds'`,
      [opId],
    );
    expect(checkExpired.rows).toHaveLength(1);
  });

  it('Provider attempt phase prevents blind re-execution after crash and transitions to failed OUTCOME_UNKNOWN', async () => {
    const account = await createTestAccount('threads_crash_test', 'Crash Account');
    const opId = generateUuidV7();
    const leaseToken = generateUuidV7();
    const keyHash = crypto.randomBytes(32);
    const reqHash = crypto.randomBytes(32);

    // Operation was claimed and provider attempt started, but process crashed before completion
    await pool.query(
      `INSERT INTO social_account_operations (
         id, workspace_id, social_account_id, principal_id, route_key,
         key_hash, request_hash, operation_type, status, phase, lease_token,
         lease_expires_at, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, 'POST /refresh', $5, $6, 'refresh', 'pending', 'provider_attempt_started', $7, NOW() - interval '10 seconds', NOW() - interval '200 seconds', NOW() + interval '1 day')`,
      [opId, wsId, account.id, userId, keyHash, reqHash, leaseToken],
    );

    // When recovery / new request arrives with same key after crash:
    let providerCalled = false;
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: {
          idempotencyKey: generateUuidV7(),
          keyHash,
          requestHash: reqHash,
          routeKey: 'POST /refresh',
        },
        executeMutation: async () => {
          providerCalled = true;
          return account;
        },
      }),
    ).rejects.toThrow(SocialAuthOutcomeUnknownError);

    // CRITICAL: provider is NOT called blindly!
    expect(providerCalled).toBe(false);

    // The crashed operation was marked as failed with safe OUTCOME_UNKNOWN error
    const opRow = await pool.query(
      `SELECT status, phase, error_code, error_message FROM social_account_operations WHERE id = $1`,
      [opId],
    );
    expect(opRow.rows[0]?.status).toBe('failed');
    expect(opRow.rows[0]?.phase).toBe('terminal');
    expect(opRow.rows[0]?.error_code).toBe('OUTCOME_UNKNOWN');
    expect(opRow.rows[0]?.error_message).toContain(
      'Provider request timed out before outcome could be established safely',
    );
  });

  it('Crash before provider call (phase=claimed) safely reclaims operation with fresh lease upon expiry and executes', async () => {
    const account = await createTestAccount('threads_precall_crash', 'PreCall Crash Account');
    const opId = generateUuidV7();
    const leaseToken = generateUuidV7();
    const keyHash = crypto.randomBytes(32);
    const reqHash = crypto.randomBytes(32);

    // Operation was claimed, but process crashed BEFORE provider attempt started (phase is still 'claimed')
    await pool.query(
      `INSERT INTO social_account_operations (
         id, workspace_id, social_account_id, principal_id, route_key,
         key_hash, request_hash, operation_type, status, phase, lease_token,
         lease_expires_at, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, 'POST /refresh', $5, $6, 'refresh', 'pending', 'claimed', $7, NOW() - interval '10 seconds', NOW() - interval '200 seconds', NOW() + interval '1 day')`,
      [opId, wsId, account.id, userId, keyHash, reqHash, leaseToken],
    );

    // When recovery / new request arrives with same key after pre-call crash:
    let providerCalled = false;
    let acquiredLeaseToken = '';
    const recoveryResult = await adapter.executeMutationWithIdempotency({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      idempotency: {
        idempotencyKey: generateUuidV7(),
        keyHash,
        requestHash: reqHash,
        routeKey: 'POST /refresh',
      },
      executeMutation: async (claimed) => {
        providerCalled = true;
        acquiredLeaseToken = claimed?.leaseToken ?? '';
        return account;
      },
    });

    // CRITICAL: Safe pre-call work is reclaimed and provider IS executed
    expect(providerCalled).toBe(true);
    expect(acquiredLeaseToken).not.toBe('');
    expect(acquiredLeaseToken).not.toBe(leaseToken); // fresh lease token!
    expect(recoveryResult.status).toBe('completed');
  });

  it('Durable asynchronous revocation worker handles failures safely without reactivating account', async () => {
    const account = await createTestAccount('threads_rev_fail', 'Rev Fail Account');

    const failingAdapter: SocialAuthAdapter = {
      platform: 'threads',
      supportsRefresh: false,
      supportsRevocation: true,
      createAuthorizationUrl: async () => ({ authorizationUrl: 'http://localhost' }),
      exchangeCode: async () => {
        throw new Error('Not implemented');
      },
      revokeToken: async () => {
        throw new Error('Provider remote service 503 unavailable');
      },
    };

    const deps = {
      persistence: adapter,
      protector,
      adapters: new Map<SocialPlatform, SocialAuthAdapter>([['threads', failingAdapter]]),
      enabled: true,
      clock: { now: () => new Date() },
    };

    // Disconnect locally
    await disconnectSocialAccount(
      {
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        expectedVersion: account.version,
      },
      deps,
    );

    // Worker attempts revocation and fails
    const workerRes = await processDueSocialAccountRevocations(
      { workerId: 'worker-rev-failing', maxBatchSize: 1 },
      deps,
    );

    expect(workerRes.processedCount).toBe(1);
    expect(workerRes.failedCount).toBe(1);

    // Check DB invariants:
    // 1. Account MUST REMAIN disconnected (never reactivated)
    const checkAcc = await adapter.findSocialAccountById({
      workspaceId: wsId,
      accountId: account.id,
    });
    expect(checkAcc?.status).toBe('disconnected');
    expect(checkAcc?.externalRevocationResult).toBe('failed');

    // 2. Job marked terminal failed with safe error code (not raw message)
    const jobRow = await pool.query(
      `SELECT status, phase, error_code, error_message FROM social_account_revocations WHERE social_account_id = $1`,
      [account.id],
    );
    expect(jobRow.rows[0]?.status).toBe('failed');
    expect(jobRow.rows[0]?.phase).toBe('terminal');
    expect(jobRow.rows[0]?.error_code).toBe('INTERNAL_ERROR');
    expect(jobRow.rows[0]?.error_message).not.toContain('503');
  });
});
