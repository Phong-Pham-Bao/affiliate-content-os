import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL Tenancy Schema and Constraints Integration', () => {
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

  it('inspects exact tables created by migrations', async () => {
    const res = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name ASC;
    `);

    const tableNames = res.rows.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'schema_migrations',
      'users',
      'workspace_memberships',
      'workspaces',
    ]);
  });

  it('enforces users table constraints independently', async () => {
    const validUserId = '0192b012-3456-789a-8bcd-ef0123456701';
    const validTime = new Date().toISOString();

    // Valid insert
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'issuer.example.com', 'sub1', 'u1@example.com', 'User 1', 'active', $2, $2, 1);`,
      [validUserId, validTime],
    );

    // Duplicate identity_provider + identity_subject
    await expect(
      client.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456702', 'issuer.example.com', 'sub1', 'other@example.com', 'User 2', 'active', $1, $1, 1);`,
        [validTime],
      ),
    ).rejects.toThrow(/users_identity_provider_subject_unique/);

    // Invalid status check
    await expect(
      client.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456703', 'issuer.example.com', 'sub3', null, null, 'archived', $1, $1, 1);`,
        [validTime],
      ),
    ).rejects.toThrow(/users_status_check/);

    // Empty trimmed identity_provider
    await expect(
      client.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456704', '   ', 'sub4', null, null, 'active', $1, $1, 1);`,
        [validTime],
      ),
    ).rejects.toThrow(/users_identity_provider_not_empty_check/);

    // Version < 1
    await expect(
      client.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456705', 'issuer.example.com', 'sub5', null, null, 'active', $1, $1, 0);`,
        [validTime],
      ),
    ).rejects.toThrow(/users_version_check/);

    // updated_at < created_at
    await expect(
      client.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456706', 'issuer.example.com', 'sub6', null, null, 'active', '2026-10-25T12:00:00Z', '2026-10-24T12:00:00Z', 1);`,
      ),
    ).rejects.toThrow(/users_updated_at_check/);
  });

  it('enforces workspaces table constraints independently', async () => {
    const validWsId = '0192b012-3456-789a-8bcd-ef0123456711';
    const validTime = new Date().toISOString();

    // Valid insert
    await client.query(
      `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
       VALUES ($1, 'Acme Main', 'acme-main', 'UTC', null, null, false, 'active', $2, $2, 1);`,
      [validWsId, validTime],
    );

    // Duplicate slug
    await expect(
      client.query(
        `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456712', 'Acme Duplicate', 'acme-main', 'UTC', null, null, false, 'active', $1, $1, 1);`,
        [validTime],
      ),
    ).rejects.toThrow(/workspaces_slug_unique/);

    // Invalid slug formats
    const invalidSlugs = ['ACME', 'acme--main', '-acme', 'acme-', 'acme_main', 'acme!main', 'аcme'];
    for (const badSlug of invalidSlugs) {
      await expect(
        client.query(
          `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456713', 'Bad Slug', $1, 'UTC', null, null, false, 'active', $2, $2, 1);`,
          [badSlug, validTime],
        ),
      ).rejects.toThrow(/workspaces_slug_format_check/);
    }

    // Invalid status
    await expect(
      client.query(
        `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456714', 'Bad Status', 'bad-status', 'UTC', null, null, false, 'pending', $1, $1, 1);`,
        [validTime],
      ),
    ).rejects.toThrow(/workspaces_status_check/);

    // Empty trimmed name
    await expect(
      client.query(
        `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456715', '   ', 'empty-name', 'UTC', null, null, false, 'active', $1, $1, 1);`,
        [validTime],
      ),
    ).rejects.toThrow(/workspaces_name_not_empty_check/);
  });

  it('enforces workspace_memberships constraints and foreign keys', async () => {
    const validUserId = '0192b012-3456-789a-8bcd-ef0123456701';
    const validWsId = '0192b012-3456-789a-8bcd-ef0123456711';
    const validMemId = '0192b012-3456-789a-8bcd-ef0123456721';
    const validTime = new Date().toISOString();

    // Valid insert
    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
       VALUES ($1, $2, $3, 'owner', 'active', null, $4, $4, $4, 1);`,
      [validMemId, validWsId, validUserId, validTime],
    );

    // Duplicate (workspace_id, user_id)
    await expect(
      client.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456722', $1, $2, 'editor', 'active', null, $3, $3, $3, 1);`,
        [validWsId, validUserId, validTime],
      ),
    ).rejects.toThrow(/workspace_memberships_workspace_user_unique/);

    // Active status requires non-null joined_at
    await expect(
      client.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456723', $1, $2, 'viewer', 'active', null, null, $3, $3, 1);`,
        [validWsId, '0192b012-3456-789a-8bcd-ef0123456702', validTime],
      ),
    ).rejects.toThrow(/workspace_memberships_active_joined_at_check/);

    // Invalid role
    await expect(
      client.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456724', $1, $2, 'admin', 'active', null, $3, $3, $3, 1);`,
        [validWsId, '0192b012-3456-789a-8bcd-ef0123456702', validTime],
      ),
    ).rejects.toThrow(/workspace_memberships_role_check/);

    // Foreign key constraint: non-existent workspace
    await expect(
      client.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
         VALUES ('0192b012-3456-789a-8bcd-ef0123456725', '0192b012-3456-789a-8bcd-ef0123456799', $1, 'owner', 'active', null, $2, $2, $2, 1);`,
        [validUserId, validTime],
      ),
    ).rejects.toThrow(/workspace_memberships_workspace_id_fkey/);
  });
});
