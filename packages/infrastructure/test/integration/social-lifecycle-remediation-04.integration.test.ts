import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  generateUuidV7,
  maintainDueSocialAccounts,
  processDueSocialAccountRevocations,
  refreshSocialAccount,
  SocialAccountReauthRequiredError,
  SocialAuthOutcomeUnknownError,
  SocialOperationFenceLostError,
  type SocialAuthAdapter,
} from '@affiliate-content-os/application';
import { createDatabase, type Database } from '../../src/database/index.js';
import {
  LocalSocialCredentialProtector,
  PostgresSocialPersistenceAdapter,
} from '../../src/social/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('TASK-017 Remediation 04 Terminal Replay & Strict Fencing Integration', () => {
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
       VALUES ($1, 'google', 'sub-rem-04-1', 'rem04@example.com', 'active', NOW(), NOW())`,
      [userId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at)
       VALUES ($1, 'Remediation 04 WS', 'ws-rem-04', 'UTC', 'active', NOW(), NOW())`,
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

  it('proves terminal failed operation is replayed without reclaiming or repeating provider call across second, third, and new-key retries', async () => {
    const account = await createTestAccount('threads_terminal_replay', 'Terminal Replay User');
    const idempotencyKey = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest();
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ act: 'refresh' }))
      .digest();
    const routeKey = 'POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/refresh';
    const pastLeaseExpiresAt = new Date(Date.now() - 60000).toISOString();
    const pastCreatedAt = new Date(Date.now() - 3600000).toISOString();
    const opId = generateUuidV7();

    // 1. Manually insert expired operation in provider_attempt_started phase (simulating crash during provider call)
    await pool.query(
      `INSERT INTO social_account_operations (
         id, workspace_id, social_account_id, principal_id, route_key,
         key_hash, request_hash, operation_type, status, phase, lease_token,
         lease_expires_at, created_at, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'refresh', 'pending', 'provider_attempt_started', $8,
         $9, $10, NOW() + interval '1 day'
       )`,
      [
        opId,
        wsId,
        account.id,
        userId,
        routeKey,
        keyHash,
        requestHash,
        generateUuidV7(),
        pastLeaseExpiresAt,
        pastCreatedAt,
      ],
    );

    let providerCallCount = 0;
    const executeMutation = async () => {
      providerCallCount++;
      return account;
    };

    // 2. First recovery attempt: detects expired provider_attempt_started -> terminally fails operation as OUTCOME_UNKNOWN, updates account to reauth_required
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
        executeMutation,
      }),
    ).rejects.toThrow(SocialAuthOutcomeUnknownError);
    expect(providerCallCount).toBe(0);

    // Verify operation is terminal failed in DB
    const opCheck1 = await pool.query(
      `SELECT status, phase, error_code FROM social_account_operations WHERE id = $1`,
      [opId],
    );
    expect(opCheck1.rows[0]).toEqual({
      status: 'failed',
      phase: 'terminal',
      error_code: 'OUTCOME_UNKNOWN',
    });

    // Verify account is reauth_required
    const accCheck1 = await pool.query(
      `SELECT status, status_reason FROM social_accounts WHERE id = $1`,
      [account.id],
    );
    expect(accCheck1.rows[0]).toEqual({
      status: 'reauth_required',
      status_reason: 'token_expired',
    });

    // 3. Second attempt with SAME idempotency key: must replay terminal failure and NEVER reclaim or call provider!
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
        executeMutation,
      }),
    ).rejects.toThrow(SocialAuthOutcomeUnknownError);
    expect(providerCallCount).toBe(0);

    // 4. Third attempt with SAME idempotency key: still terminal replay, NEVER reclaimed!
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
        executeMutation,
      }),
    ).rejects.toThrow(SocialAuthOutcomeUnknownError);
    expect(providerCallCount).toBe(0);

    // 5. Attempt with a DIFFERENT idempotency key via refreshSocialAccount: blocked because account is in reauth_required!
    const mockAdapter: SocialAuthAdapter = {
      platform: 'threads',
      supportsRefresh: true,
      supportsRevocation: false,
      createAuthorizationUrl: async () => ({ authorizationUrl: 'http://localhost' }),
      exchangeCode: async () => {
        throw new Error('Not implemented');
      },
      refreshToken: async () => {
        providerCallCount++;
        return {
          accessToken: 'new-tok',
          tokenKind: 'long_lived' as const,
          tokenExpiresInSeconds: 3600,
        };
      },
    };

    await expect(
      refreshSocialAccount(
        {
          workspaceId: wsId,
          accountId: account.id,
          actorUserId: userId,
        },
        {
          persistence: adapter,
          protector,
          adapters: new Map([['threads', mockAdapter]]),
          enabled: true,
          clock: { now: () => new Date() },
        },
      ),
    ).rejects.toThrow(SocialAccountReauthRequiredError);
    expect(providerCallCount).toBe(0); // Provider counter remained strictly 0!
  });

  it('special-cases SocialAuthOutcomeUnknownError during refresh: terminally fails operation and prevents subsequent maintenance/manual calls', async () => {
    const account = await createTestAccount('threads_timeout_case', 'Timeout Case User');
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
        throw new SocialAuthOutcomeUnknownError('Gateway timeout on Meta server');
      },
    };

    const idempotencyKey = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest();
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ act: 'refresh' }))
      .digest();
    const routeKey = 'POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/refresh';

    // 1. Initial manual refresh times out
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
        executeMutation: async (claimedOp) => {
          const res = await refreshSocialAccount(
            {
              workspaceId: wsId,
              accountId: account.id,
              actorUserId: userId,
              claimToken: claimedOp?.leaseToken,
              operationId: claimedOp?.operationId,
            },
            {
              persistence: adapter,
              protector,
              adapters: new Map([['threads', mockAdapter]]),
              enabled: true,
              clock: { now: () => new Date() },
            },
          );
          return res.account;
        },
      }),
    ).rejects.toThrow(SocialAuthOutcomeUnknownError);

    expect(providerCalls).toBe(1);

    // 2. Account is in reauth_required and next_refresh_at is null
    const accRow = await pool.query(
      `SELECT status, status_reason, next_refresh_at FROM social_accounts WHERE id = $1`,
      [account.id],
    );
    expect(accRow.rows[0].status).toBe('reauth_required');
    expect(accRow.rows[0].status_reason).toBe('reauth_required');
    expect(accRow.rows[0].next_refresh_at).toBeNull();

    // 3. Automated maintenance MUST NOT select it
    const maintRes = await maintainDueSocialAccounts(
      { workerId: 'w1', maxBatchSize: 10 },
      {
        persistence: adapter,
        protector,
        adapters: new Map([['threads', mockAdapter]]),
        enabled: true,
        clock: { now: () => new Date() },
      },
    );
    expect(maintRes.claimedCount).toBe(0);
    expect(providerCalls).toBe(1); // Provider NOT called!

    // 4. Same-key retry replays terminal failure without calling provider
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
        executeMutation: async () => {
          providerCalls++;
          return account;
        },
      }),
    ).rejects.toThrow(SocialAuthOutcomeUnknownError);
    expect(providerCalls).toBe(1);

    // 5. New-key manual retry is blocked by reauth_required check
    await expect(
      refreshSocialAccount(
        {
          workspaceId: wsId,
          accountId: account.id,
          actorUserId: userId,
        },
        {
          persistence: adapter,
          protector,
          adapters: new Map([['threads', mockAdapter]]),
          enabled: true,
          clock: { now: () => new Date() },
        },
      ),
    ).rejects.toThrow(SocialAccountReauthRequiredError);
    expect(providerCalls).toBe(1);
  });

  it('validates CAS rowCount on every fenced transition: stale tokens throw SocialOperationFenceLostError', async () => {
    // 1. markOperationAttemptStarted with invalid lease token throws SocialOperationFenceLostError
    await expect(
      adapter.markOperationAttemptStarted({
        operationId: generateUuidV7(),
        leaseToken: 'invalid-stale-lease-token',
      }),
    ).rejects.toThrow(SocialOperationFenceLostError);

    // 2. markSocialAccountRevocationAttemptStarted with invalid lease token throws SocialOperationFenceLostError
    await expect(
      adapter.markSocialAccountRevocationAttemptStarted({
        jobId: generateUuidV7(),
        leaseToken: 'invalid-stale-lease-token',
        now: new Date().toISOString(),
      }),
    ).rejects.toThrow(SocialOperationFenceLostError);

    // 3. completeSocialAccountRevocationJobAtomic with invalid lease token throws and leaves account unaffected
    const account = await createTestAccount('threads_stale_fencing', 'Stale Fencing User');
    await expect(
      adapter.completeSocialAccountRevocationJobAtomic({
        jobId: generateUuidV7(),
        leaseToken: 'stale-lease-token',
        workspaceId: wsId,
        accountId: account.id,
        now: new Date().toISOString(),
      }),
    ).rejects.toThrow(SocialOperationFenceLostError);

    // 4. failSocialAccountRevocationJobAtomic with invalid lease token throws and leaves account unaffected
    await expect(
      adapter.failSocialAccountRevocationJobAtomic({
        jobId: generateUuidV7(),
        leaseToken: 'stale-lease-token',
        workspaceId: wsId,
        accountId: account.id,
        errorCode: 'TEST_ERROR',
        errorMessage: 'Test error message',
        now: new Date().toISOString(),
      }),
    ).rejects.toThrow(SocialOperationFenceLostError);
  });

  it('enforces durable revocation handoff and wipes secrets on terminal results', async () => {
    const account = await createTestAccount('threads_wipe_test', 'Secret Wipe User');

    // 1. Supported disconnect stages a durable revocation job and deletes active credentials
    const disconnected = await adapter.disconnectSocialAccountAtomic({
      workspaceId: wsId,
      accountId: account.id,
      actorUserId: userId,
      expectedVersion: account.version,
      externalRevocationSupported: true,
      externalRevocationAttempted: false,
      externalRevocationResult: 'pending',
      now: new Date().toISOString(),
    });
    expect(disconnected.status).toBe('disconnected');

    // Verify active credential was erased
    const credCheck = await pool.query(
      `SELECT 1 FROM social_credentials WHERE social_account_id = $1`,
      [account.id],
    );
    expect(credCheck.rowCount).toBe(0);

    // Verify exactly one active revocation job exists
    const jobCheck = await pool.query(
      `SELECT id, status, phase, encrypted_token, token_iv, token_auth_tag
       FROM social_account_revocations WHERE social_account_id = $1`,
      [account.id],
    );
    expect(jobCheck.rowCount).toBe(1);
    const jobRow = jobCheck.rows[0];
    expect(jobRow.status).toBe('pending');
    expect(jobRow.phase).toBe('claimed');
    expect(jobRow.encrypted_token.length).toBeGreaterThan(0);

    // 2. Second disconnect attempt for the same account cannot create a duplicate active job
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, created_at, updated_at
         ) VALUES ($1, $2, $3, 'threads', '\\x01'::bytea, '\\x000000000000000000000000'::bytea, '\\x00000000000000000000000000000000'::bytea, 'v1', 'pending', 'claimed', NOW(), NOW())`,
        [generateUuidV7(), wsId, account.id],
      ),
    ).rejects.toThrow(/idx_social_account_revocations_active/);

    // 3. Worker claims job and completes it: assert terminal secret wiping
    const mockRevokeAdapter: SocialAuthAdapter = {
      platform: 'threads',
      supportsRefresh: true,
      supportsRevocation: true,
      createAuthorizationUrl: async () => ({ authorizationUrl: 'http://localhost' }),
      exchangeCode: async () => {
        throw new Error('Not implemented');
      },
      revokeToken: async () => ({ supported: true, revoked: true }),
    };

    const workerResult = await processDueSocialAccountRevocations(
      { workerId: 'rev-worker-1', maxBatchSize: 1 },
      {
        persistence: adapter,
        protector,
        adapters: new Map([['threads', mockRevokeAdapter]]),
        enabled: true,
        clock: { now: () => new Date() },
      },
    );
    expect(workerResult.succeededCount).toBe(1);

    // Verify secrets are wiped in database on terminal completion
    const wipedJob = await pool.query(
      `SELECT status, phase, encrypted_token, token_iv, token_auth_tag
       FROM social_account_revocations WHERE id = $1`,
      [jobRow.id],
    );
    expect(wipedJob.rows[0].status).toBe('succeeded');
    expect(wipedJob.rows[0].phase).toBe('terminal');
    // Secret columns contain empty sentinel bytes
    expect(wipedJob.rows[0].encrypted_token.length).toBe(0);
    expect(wipedJob.rows[0].token_iv).toEqual(Buffer.alloc(12));
    expect(wipedJob.rows[0].token_auth_tag).toEqual(Buffer.alloc(16));
  });

  it('validates migration 0019 schema constraints reject invalid phase/status/secret combinations', async () => {
    // 1. phase = 'terminal' with status = 'pending' violates phase_status_check
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, completed_at, created_at, updated_at
         ) VALUES ($1, $2, (SELECT id FROM social_accounts LIMIT 1), 'threads', '\\x'::bytea, '\\x000000000000000000000000'::bytea, '\\x00000000000000000000000000000000'::bytea, 'v1', 'pending', 'terminal', NOW(), NOW(), NOW())`,
        [generateUuidV7(), wsId],
      ),
    ).rejects.toThrow(/social_account_revocations_phase_status_check/);

    // 2. phase = 'terminal' with completed_at = NULL violates completed_at_check
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, completed_at, created_at, updated_at
         ) VALUES ($1, $2, (SELECT id FROM social_accounts LIMIT 1), 'threads', '\\x'::bytea, '\\x000000000000000000000000'::bytea, '\\x00000000000000000000000000000000'::bytea, 'v1', 'failed', 'terminal', NULL, NOW(), NOW())`,
        [generateUuidV7(), wsId],
      ),
    ).rejects.toThrow(/social_account_revocations_completed_at_check/);

    // 3. phase = 'terminal' with non-empty encrypted_token violates secret_wipe_check
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, completed_at, error_code, error_message, created_at, updated_at
         ) VALUES ($1, $2, (SELECT id FROM social_accounts LIMIT 1), 'threads', '\\x0102'::bytea, '\\x000000000000000000000000'::bytea, '\\x00000000000000000000000000000000'::bytea, 'v1', 'failed', 'terminal', NOW(), 'ERR', 'msg', NOW(), NOW())`,
        [generateUuidV7(), wsId],
      ),
    ).rejects.toThrow(/social_account_revocations_secret_wipe_check/);

    // 4. Invalid platform violates platform_check
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, created_at, updated_at
         ) VALUES ($1, $2, (SELECT id FROM social_accounts LIMIT 1), 'invalid_platform', '\\x01'::bytea, '\\x000000000000000000000000'::bytea, '\\x00000000000000000000000000000000'::bytea, 'v1', 'pending', 'claimed', NOW(), NOW())`,
        [generateUuidV7(), wsId],
      ),
    ).rejects.toThrow(/social_account_revocations_platform_check/);
  });
});
