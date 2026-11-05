import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDefaultMigrationsDir } from '../../src/database/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL Auth Schema and Constraints Integration', () => {
  let context: TestDatabaseContext;
  let client: pg.Client;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    client = new pg.Client({ connectionString: context.dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
    if (context) {
      await context.cleanup();
    }
  });

  it('inspects exact tables created by migration 0003', async () => {
    const res = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name ASC;
    `);

    const tableNames = res.rows.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'application_sessions',
      'audit_events',
      'oidc_login_transactions',
      'schema_migrations',
      'users',
      'workspace_memberships',
      'workspaces',
    ]);
  });

  it('proves oidc_login_transactions constraints enforce pending vs consumed lifecycle', async () => {
    const txId1 = '0192b012-3456-789a-8bcd-ef0123456701';
    const stateHash = Buffer.alloc(32, 1);
    const browserBindingHash = Buffer.alloc(32, 2);
    const iv = Buffer.alloc(12, 3);
    const tag = Buffer.alloc(16, 4);
    const ciphertext = Buffer.from('encrypted-data');
    const now = new Date('2026-11-02T12:00:00.000Z');
    const expires = new Date('2026-11-02T12:10:00.000Z');

    // Valid pending insert
    await client.query(
      `INSERT INTO oidc_login_transactions (
        id, state_hash, browser_binding_hash, secrets_ciphertext, secrets_iv, secrets_auth_tag,
        key_version, return_to, status, created_at, expires_at, consumed_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, 1);`,
      [
        txId1,
        stateHash,
        browserBindingHash,
        ciphertext,
        iv,
        tag,
        'v1',
        '/dashboard',
        'pending',
        now,
        expires,
      ],
    );

    // Cannot insert consumed with secrets
    const txId2 = '0192b012-3456-789a-8bcd-ef0123456702';
    const stateHash2 = Buffer.alloc(32, 5);
    await expect(
      client.query(
        `INSERT INTO oidc_login_transactions (
          id, state_hash, browser_binding_hash, secrets_ciphertext, secrets_iv, secrets_auth_tag,
          key_version, return_to, status, created_at, expires_at, consumed_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1);`,
        [
          txId2,
          stateHash2,
          browserBindingHash,
          ciphertext,
          iv,
          tag,
          'v1',
          '/dashboard',
          'consumed',
          now,
          expires,
          now,
        ],
      ),
    ).rejects.toThrow();

    // Consume txId1: transition to consumed and scrub secrets
    const consumedAt = new Date('2026-11-02T12:05:00.000Z');
    await client.query(
      `UPDATE oidc_login_transactions
       SET status = 'consumed',
           consumed_at = $1,
           secrets_ciphertext = NULL,
           secrets_iv = NULL,
           secrets_auth_tag = NULL,
           version = version + 1
       WHERE id = $2;`,
      [consumedAt, txId1],
    );

    const updated = await client.query<{
      status: string;
      consumed_at: Date;
      secrets_ciphertext: Buffer | null;
    }>(
      `SELECT status, consumed_at, secrets_ciphertext FROM oidc_login_transactions WHERE id = $1;`,
      [txId1],
    );
    expect(updated.rows[0]!.status).toBe('consumed');
    expect(updated.rows[0]!.consumed_at).toEqual(consumedAt);
    expect(updated.rows[0]!.secrets_ciphertext).toBeNull();
  });

  it('proves oidc_login_transactions rejects wrong hash byte lengths and return paths', async () => {
    const txId = '0192b012-3456-789a-8bcd-ef0123456703';
    const badHash = Buffer.alloc(31, 1);
    const validHash = Buffer.alloc(32, 1);
    const iv = Buffer.alloc(12, 3);
    const tag = Buffer.alloc(16, 4);
    const ciphertext = Buffer.from('ciphertext');
    const now = new Date('2026-11-02T12:00:00.000Z');
    const expires = new Date('2026-11-02T12:10:00.000Z');

    // 31-byte state_hash rejected
    await expect(
      client.query(
        `INSERT INTO oidc_login_transactions (
          id, state_hash, browser_binding_hash, secrets_ciphertext, secrets_iv, secrets_auth_tag,
          key_version, return_to, status, created_at, expires_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1);`,
        [txId, badHash, validHash, ciphertext, iv, tag, 'v1', '/valid', 'pending', now, expires],
      ),
    ).rejects.toThrow();

    // Protocol-relative return_to rejected (//evil.com)
    const stateHash3 = Buffer.alloc(32, 6);
    await expect(
      client.query(
        `INSERT INTO oidc_login_transactions (
          id, state_hash, browser_binding_hash, secrets_ciphertext, secrets_iv, secrets_auth_tag,
          key_version, return_to, status, created_at, expires_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1);`,
        [
          txId,
          stateHash3,
          validHash,
          ciphertext,
          iv,
          tag,
          'v1',
          '//evil.com',
          'pending',
          now,
          expires,
        ],
      ),
    ).rejects.toThrow();
  });

  it('proves application_sessions constraints enforce active vs revoked lifecycle and token hashing', async () => {
    const userId = '0192b012-3456-789a-8bcd-ef0123456710';
    const now = new Date('2026-11-02T12:00:00.000Z');

    // Create user
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'https://issuer.example.com', 'sub-1', 'u@ex.com', 'User 1', 'active', $2, $2, 1);`,
      [userId, now],
    );

    const sessionId = '0192b012-3456-789a-8bcd-ef0123456720';
    const tokenHash = Buffer.alloc(32, 10);
    const idleExpires = new Date('2026-11-02T12:30:00.000Z');
    const absExpires = new Date('2026-11-02T20:00:00.000Z');

    // Insert active session
    await client.query(
      `INSERT INTO application_sessions (
        id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
        revoked_at, revocation_reason, version
      ) VALUES ($1, $2, $3, NULL, NULL, $4, $4, $5, $6, $4, NULL, NULL, 1);`,
      [sessionId, userId, tokenHash, now, idleExpires, absExpires],
    );

    // Rotate token: move current to previous, install new current
    const newTokenHash = Buffer.alloc(32, 11);
    const rotatedAt = new Date('2026-11-02T12:15:00.000Z');
    const graceValidUntil = new Date('2026-11-02T12:15:30.000Z');

    await client.query(
      `UPDATE application_sessions
       SET current_token_hash = $1,
           previous_token_hash = $2,
           previous_token_valid_until = $3,
           rotated_at = $4,
           last_seen_at = $4,
           version = version + 1
       WHERE id = $5;`,
      [newTokenHash, tokenHash, graceValidUntil, rotatedAt, sessionId],
    );

    // Partial unique index prevents duplicate current token hash
    const session2Id = '0192b012-3456-789a-8bcd-ef0123456721';
    await expect(
      client.query(
        `INSERT INTO application_sessions (
          id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
          created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
          revoked_at, revocation_reason, version
        ) VALUES ($1, $2, $3, NULL, NULL, $4, $4, $5, $6, $4, NULL, NULL, 1);`,
        [session2Id, userId, newTokenHash, now, idleExpires, absExpires],
      ),
    ).rejects.toThrow();

    // Revocation: nulls token hashes and sets revoked_at + revocation_reason
    const revokedAt = new Date('2026-11-02T12:20:00.000Z');
    await client.query(
      `UPDATE application_sessions
       SET current_token_hash = NULL,
           previous_token_hash = NULL,
           previous_token_valid_until = NULL,
           revoked_at = $1,
           revocation_reason = 'logout',
           version = version + 1
       WHERE id = $2;`,
      [revokedAt, sessionId],
    );

    const revoked = await client.query<{
      current_token_hash: Buffer | null;
      previous_token_hash: Buffer | null;
      revocation_reason: string;
    }>(
      `SELECT current_token_hash, previous_token_hash, revocation_reason
       FROM application_sessions WHERE id = $1;`,
      [sessionId],
    );
    expect(revoked.rows[0]!.current_token_hash).toBeNull();
    expect(revoked.rows[0]!.previous_token_hash).toBeNull();
    expect(revoked.rows[0]!.revocation_reason).toBe('logout');

    // Revoked row cannot have token hashes (lifecycle check)
    await expect(
      client.query(`UPDATE application_sessions SET current_token_hash = $1 WHERE id = $2;`, [
        newTokenHash,
        sessionId,
      ]),
    ).rejects.toThrow();
  });

  it('proves application_sessions_timestamps_order_check strictly enforces all timestamp invariants', async () => {
    const userId = '0192b012-3456-789a-8bcd-ef0123456711';
    const createdAt = new Date('2026-11-02T12:00:00.000Z');

    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'https://issuer.example.com', 'sub-timestamps', 'ts@ex.com', 'TS User', 'active', $2, $2, 1);`,
      [userId, createdAt],
    );

    const tokenHash = Buffer.alloc(32, 20);
    const validIdle = new Date('2026-11-02T12:30:00.000Z');
    const validAbs = new Date('2026-11-02T20:00:00.000Z');

    // Invariant 1: last_seen_at > idle_expires_at must be rejected (Finding 7 regression)
    const badSession1 = '0192b012-3456-789a-8bcd-ef0123456722';
    const badLastSeen = new Date('2026-11-02T12:35:00.000Z'); // after idleExpires
    await expect(
      client.query(
        `INSERT INTO application_sessions (
          id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
          created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
          revoked_at, revocation_reason, version
        ) VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $4, NULL, NULL, 1);`,
        [badSession1, userId, tokenHash, createdAt, badLastSeen, validIdle, validAbs],
      ),
    ).rejects.toThrow();

    // Invariant 2: rotated_at > last_seen_at must be rejected
    const badSession2 = '0192b012-3456-789a-8bcd-ef0123456723';
    const badRotatedAt = new Date('2026-11-02T12:15:00.000Z');
    const pastLastSeen = new Date('2026-11-02T12:10:00.000Z');
    await expect(
      client.query(
        `INSERT INTO application_sessions (
          id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
          created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
          revoked_at, revocation_reason, version
        ) VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8, NULL, NULL, 1);`,
        [
          badSession2,
          userId,
          tokenHash,
          createdAt,
          pastLastSeen,
          validIdle,
          validAbs,
          badRotatedAt,
        ],
      ),
    ).rejects.toThrow();

    // Invariant 3: created_at > rotated_at must be rejected
    const badSession3 = '0192b012-3456-789a-8bcd-ef0123456724';
    const preCreatedAt = new Date('2026-11-02T11:50:00.000Z');
    await expect(
      client.query(
        `INSERT INTO application_sessions (
          id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
          created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
          revoked_at, revocation_reason, version
        ) VALUES ($1, $2, $3, NULL, NULL, $4, $4, $5, $6, $7, NULL, NULL, 1);`,
        [badSession3, userId, tokenHash, createdAt, validIdle, validAbs, preCreatedAt],
      ),
    ).rejects.toThrow();

    // Invariant 4: idle_expires_at > absolute_expires_at must be rejected
    const badSession4 = '0192b012-3456-789a-8bcd-ef0123456725';
    const excessiveIdle = new Date('2026-11-02T21:00:00.000Z'); // after abs
    await expect(
      client.query(
        `INSERT INTO application_sessions (
          id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
          created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
          revoked_at, revocation_reason, version
        ) VALUES ($1, $2, $3, NULL, NULL, $4, $4, $5, $6, $4, NULL, NULL, 1);`,
        [badSession4, userId, tokenHash, createdAt, excessiveIdle, validAbs],
      ),
    ).rejects.toThrow();

    // Permitted equality boundary 1: created_at = rotated_at = last_seen_at = idle_expires_at < absolute_expires_at
    const eqSession1 = '0192b012-3456-789a-8bcd-ef0123456726';
    const eqHash1 = Buffer.alloc(32, 21);
    await client.query(
      `INSERT INTO application_sessions (
        id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
        revoked_at, revocation_reason, version
      ) VALUES ($1, $2, $3, NULL, NULL, $4, $4, $4, $5, $4, NULL, NULL, 1);`,
      [eqSession1, userId, eqHash1, createdAt, validAbs],
    );

    // Permitted equality boundary 2: idle_expires_at = absolute_expires_at
    const eqSession2 = '0192b012-3456-789a-8bcd-ef0123456727';
    const eqHash2 = Buffer.alloc(32, 22);
    await client.query(
      `INSERT INTO application_sessions (
        id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
        revoked_at, revocation_reason, version
      ) VALUES ($1, $2, $3, NULL, NULL, $4, $4, $5, $5, $4, NULL, NULL, 1);`,
      [eqSession2, userId, eqHash2, createdAt, validAbs],
    );

    // Permitted equality boundary 3: rotated_at = created_at < last_seen_at = idle_expires_at = absolute_expires_at
    const eqSession3 = '0192b012-3456-789a-8bcd-ef0123456728';
    const eqHash3 = Buffer.alloc(32, 23);
    await client.query(
      `INSERT INTO application_sessions (
        id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
        revoked_at, revocation_reason, version
      ) VALUES ($1, $2, $3, NULL, NULL, $4, $5, $5, $5, $4, NULL, NULL, 1);`,
      [eqSession3, userId, eqHash3, createdAt, validAbs],
    );
  });

  it('proves upgrade from TASK-005 schema (migrations 0001 and 0002) to TASK-006 (migration 0003) preserves all existing data and establishes auth tables', async () => {
    const upgradeContext = await setupIsolatedTestDatabase({ skipMigrations: true });
    const upgradeClient = new pg.Client({ connectionString: upgradeContext.dbUrl });
    await upgradeClient.connect();

    try {
      const migrationsDir = getDefaultMigrationsDir();
      const m0001Path = path.join(migrationsDir, '0001_baseline.sql');
      const m0002Path = path.join(migrationsDir, '0002_identity_tenancy.sql');
      const m0003Path = path.join(migrationsDir, '0003_application_auth.sql');

      await upgradeClient.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          migration_number INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum_sha256 TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const sql0001 = fs.readFileSync(m0001Path, 'utf8');
      await upgradeClient.query(sql0001);
      await upgradeClient.query(
        `INSERT INTO schema_migrations (migration_number, name, checksum_sha256) VALUES (1, 'baseline', 'dummy');`,
      );

      const sql0002 = fs.readFileSync(m0002Path, 'utf8');
      await upgradeClient.query(sql0002);
      await upgradeClient.query(
        `INSERT INTO schema_migrations (migration_number, name, checksum_sha256) VALUES (2, 'identity_tenancy', 'dummy');`,
      );

      const seedUserId = '0192b012-3456-789a-8bcd-ef0123456799';
      const seedWorkspaceId = '0192b012-3456-789a-8bcd-ef0123456788';
      const seedMembershipId = '0192b012-3456-789a-8bcd-ef0123456777';
      const now = new Date('2026-11-02T12:00:00.000Z');

      await upgradeClient.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ($1, 'https://issuer.example.com', 'upgrade-sub', 'up@ex.com', 'Upgrade User', 'active', $2, $2, 1);`,
        [seedUserId, now],
      );

      await upgradeClient.query(
        `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
         VALUES ($1, 'Upgrade WS', 'upgrade-ws', 'UTC', NULL, NULL, false, 'active', $2, $2, 1);`,
        [seedWorkspaceId, now],
      );

      await upgradeClient.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
         VALUES ($1, $2, $3, 'owner', 'active', NULL, $4, $4, $4, 1);`,
        [seedMembershipId, seedWorkspaceId, seedUserId, now],
      );

      const sql0003 = fs.readFileSync(m0003Path, 'utf8');
      await upgradeClient.query(sql0003);
      await upgradeClient.query(
        `INSERT INTO schema_migrations (migration_number, name, checksum_sha256) VALUES (3, 'application_auth', 'dummy');`,
      );

      const userRes = await upgradeClient.query<{ email: string; status: string }>(
        `SELECT email, status FROM users WHERE id = $1;`,
        [seedUserId],
      );
      expect(userRes.rows[0]?.email).toBe('up@ex.com');
      expect(userRes.rows[0]?.status).toBe('active');

      const wsRes = await upgradeClient.query<{ slug: string }>(
        `SELECT slug FROM workspaces WHERE id = $1;`,
        [seedWorkspaceId],
      );
      expect(wsRes.rows[0]?.slug).toBe('upgrade-ws');

      const memRes = await upgradeClient.query<{ role: string }>(
        `SELECT role FROM workspace_memberships WHERE id = $1;`,
        [seedMembershipId],
      );
      expect(memRes.rows[0]?.role).toBe('owner');

      const sessionId = '0192b012-3456-789a-8bcd-ef0123456766';
      const tokenHash = Buffer.alloc(32, 42);
      await upgradeClient.query(
        `INSERT INTO application_sessions (
          id, user_id, current_token_hash, previous_token_hash, previous_token_valid_until,
          created_at, last_seen_at, idle_expires_at, absolute_expires_at, rotated_at,
          revoked_at, revocation_reason, version
        ) VALUES ($1, $2, $3, NULL, NULL, $4, $4, $5, $6, $4, NULL, NULL, 1);`,
        [
          sessionId,
          seedUserId,
          tokenHash,
          now,
          new Date('2026-11-02T12:30:00.000Z'),
          new Date('2026-11-02T20:00:00.000Z'),
        ],
      );

      const sessRes = await upgradeClient.query<{ user_id: string }>(
        `SELECT user_id FROM application_sessions WHERE id = $1;`,
        [sessionId],
      );
      expect(sessRes.rows[0]?.user_id).toBe(seedUserId);
    } finally {
      await upgradeClient.end();
      await upgradeContext.cleanup();
    }
  });
});
