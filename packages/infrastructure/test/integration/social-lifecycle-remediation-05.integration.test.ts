import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { generateUuidV7, SocialOperationFenceLostError } from '@affiliate-content-os/application';
import { createDatabase, type Database } from '../../src/database/index.js';
import { PostgresSocialPersistenceAdapter } from '../../src/social/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('TASK-017 Remediation 05 Operation Failure Fencing and Sentinel Constraints', () => {
  let testCtx: TestDatabaseContext;
  let pool: pg.Pool;
  let database: Database;
  let adapter: PostgresSocialPersistenceAdapter;

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
       VALUES ($1, 'google', 'sub-rem-05-1', 'rem05@example.com', 'active', NOW(), NOW())`,
      [userId],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, slug, timezone, status, created_at, updated_at)
       VALUES ($1, 'Remediation 05 WS', 'ws-rem-05', 'UTC', 'active', NOW(), NOW())`,
      [wsId],
    );
  });

  afterAll(async () => {
    await database.close();
    await pool.end();
    await testCtx.cleanup();
  });

  async function createTestAccount(providerAccountId: string) {
    const id = generateUuidV7();
    await pool.query(
      `INSERT INTO social_accounts (
         id, workspace_id, platform, provider_account_id, display_name, handle,
         status, status_reason, version, connected_by_user_id, created_at, updated_at
       ) VALUES ($1, $2, 'threads', $3, $4, $5, 'active', 'initial_exchange_complete', 1, $6, NOW(), NOW())`,
      [id, wsId, providerAccountId, `User ${providerAccountId}`, `@${providerAccountId}`, userId],
    );
    return { id };
  }

  it('proves a stale lease token on the failure path throws SocialOperationFenceLostError and does not overwrite stored operation', async () => {
    const account = await createTestAccount('threads_stale_fail_test');
    const idempotencyKey = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest();
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ test: 'fail' }))
      .digest();
    const routeKey = 'POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/refresh';

    const stolenLeaseToken = generateUuidV7();
    let operationIdCaptured = '';

    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
        executeMutation: async (claimedOp) => {
          operationIdCaptured = claimedOp!.operationId;
          // Concurrent worker or lease renewal steals the lease token
          await pool.query(
            `UPDATE social_account_operations
             SET lease_token = $2
             WHERE id = $1`,
            [claimedOp!.operationId, stolenLeaseToken],
          );
          // Mutation fails with an arbitrary internal/provider error
          throw new Error('Upstream provider exploded');
        },
      }),
    ).rejects.toThrow(SocialOperationFenceLostError);

    // Stored operation was NOT overwritten by the stale owner!
    const opRow = await pool.query(
      `SELECT status, phase, lease_token, error_code, completed_at
       FROM social_account_operations
       WHERE id = $1`,
      [operationIdCaptured],
    );
    expect(opRow.rowCount).toBe(1);
    expect(opRow.rows[0].status).toBe('pending');
    expect(opRow.rows[0].phase).toBe('claimed');
    expect(opRow.rows[0].lease_token).toBe(stolenLeaseToken);
    expect(opRow.rows[0].error_code).toBeNull();
    expect(opRow.rows[0].completed_at).toBeNull();
  });

  it('propagates the original error when the failure path holds a valid lease', async () => {
    const account = await createTestAccount('threads_valid_fail_test');
    const idempotencyKey = crypto.randomUUID();
    const keyHash = crypto.createHash('sha256').update(idempotencyKey).digest();
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ test: 'fail_valid' }))
      .digest();
    const routeKey = 'POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/refresh';

    let opId = '';
    await expect(
      adapter.executeMutationWithIdempotency({
        workspaceId: wsId,
        accountId: account.id,
        actorUserId: userId,
        idempotency: { idempotencyKey, keyHash, requestHash, routeKey },
        executeMutation: async (claimedOp) => {
          opId = claimedOp!.operationId;
          throw new Error('Genuine provider rejection');
        },
      }),
    ).rejects.toThrow('Genuine provider rejection');

    // Stored operation transitioned to terminal failed
    const opRow = await pool.query(
      `SELECT status, phase, error_code, completed_at
       FROM social_account_operations
       WHERE id = $1`,
      [opId],
    );
    expect(opRow.rowCount).toBe(1);
    expect(opRow.rows[0].status).toBe('failed');
    expect(opRow.rows[0].phase).toBe('terminal');
    expect(opRow.rows[0].completed_at).not.toBeNull();
  });

  it('Migration 0020 rejects malformed terminal secret sentinels and accepts valid terminal and active rows', async () => {
    const account = await createTestAccount('threads_sentinel_test');
    const zeroIv = Buffer.alloc(12);
    const nonzeroIv = Buffer.from('0102030405060708090a0b0c', 'hex');
    const zeroAuthTag = Buffer.alloc(16);
    const nonzeroAuthTag = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex');

    // 1. Terminal row with nonzero IV is rejected
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, completed_at, error_code, error_message, created_at, updated_at
         ) VALUES ($1, $2, $3, 'threads', '\\x'::bytea, $4, $5, 'v1', 'failed', 'terminal', NOW(), 'ERR', 'msg', NOW(), NOW())`,
        [generateUuidV7(), wsId, account.id, nonzeroIv, zeroAuthTag],
      ),
    ).rejects.toThrow(/social_account_revocations_secret_wipe_check/);

    // 2. Terminal row with nonzero auth tag is rejected
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, completed_at, error_code, error_message, created_at, updated_at
         ) VALUES ($1, $2, $3, 'threads', '\\x'::bytea, $4, $5, 'v1', 'failed', 'terminal', NOW(), 'ERR', 'msg', NOW(), NOW())`,
        [generateUuidV7(), wsId, account.id, zeroIv, nonzeroAuthTag],
      ),
    ).rejects.toThrow(/social_account_revocations_secret_wipe_check/);

    // 3. Terminal row with nonempty token is rejected
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, completed_at, error_code, error_message, created_at, updated_at
         ) VALUES ($1, $2, $3, 'threads', '\\x1122'::bytea, $4, $5, 'v1', 'failed', 'terminal', NOW(), 'ERR', 'msg', NOW(), NOW())`,
        [generateUuidV7(), wsId, account.id, zeroIv, zeroAuthTag],
      ),
    ).rejects.toThrow(/social_account_revocations_secret_wipe_check/);

    // 4. Terminal row with defined sentinels is accepted
    const termId = generateUuidV7();
    await pool.query(
      `INSERT INTO social_account_revocations (
         id, workspace_id, social_account_id, platform,
         encrypted_token, token_iv, token_auth_tag, encryption_key_version,
         status, phase, completed_at, error_code, error_message, created_at, updated_at
       ) VALUES ($1, $2, $3, 'threads', '\\x'::bytea, $4, $5, 'v1', 'failed', 'terminal', NOW(), 'ERR', 'msg', NOW(), NOW())`,
      [termId, wsId, account.id, zeroIv, zeroAuthTag],
    );
    const termRow = await pool.query(
      'SELECT status, phase, token_iv, token_auth_tag FROM social_account_revocations WHERE id = $1',
      [termId],
    );
    expect(termRow.rows[0].status).toBe('failed');
    expect(termRow.rows[0].token_iv).toEqual(Buffer.alloc(12));
    expect(termRow.rows[0].token_auth_tag).toEqual(Buffer.alloc(16));

    // 5. Active row with nonempty token and valid IV/auth-tag lengths is accepted
    const activeId = generateUuidV7();
    await pool.query(
      `INSERT INTO social_account_revocations (
         id, workspace_id, social_account_id, platform,
         encrypted_token, token_iv, token_auth_tag, encryption_key_version,
         status, phase, created_at, updated_at
       ) VALUES ($1, $2, $3, 'threads', '\\x112233'::bytea, $4, $5, 'v1', 'pending', 'claimed', NOW(), NOW())`,
      [activeId, wsId, account.id, nonzeroIv, nonzeroAuthTag],
    );
    const activeRow = await pool.query(
      'SELECT status, phase FROM social_account_revocations WHERE id = $1',
      [activeId],
    );
    expect(activeRow.rows[0].status).toBe('pending');

    // 6. Active row with empty token is rejected
    await expect(
      pool.query(
        `INSERT INTO social_account_revocations (
           id, workspace_id, social_account_id, platform,
           encrypted_token, token_iv, token_auth_tag, encryption_key_version,
           status, phase, created_at, updated_at
         ) VALUES ($1, $2, $3, 'threads', '\\x'::bytea, $4, $5, 'v1', 'pending', 'claimed', NOW(), NOW())`,
        [generateUuidV7(), wsId, account.id, nonzeroIv, nonzeroAuthTag],
      ),
    ).rejects.toThrow(/social_account_revocations_secret_wipe_check/);
  });
});
