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

  it('proves required indexes exist with exact column order in PostgreSQL catalog', async () => {
    const res = await client.query<{
      index_name: string;
      column_name: string;
      column_order: string;
    }>(`
      SELECT
        i.relname AS index_name,
        a.attname AS column_name,
        pos.ord::text AS column_order
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS pos(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = pos.attnum
      WHERE t.relname = 'workspace_memberships'
        AND i.relname IN ('idx_workspace_memberships_user_workspace', 'idx_workspace_memberships_workspace_status')
      ORDER BY i.relname, pos.ord;
    `);

    const userWsCols = res.rows
      .filter((r) => r.index_name === 'idx_workspace_memberships_user_workspace')
      .map((r) => r.column_name);
    expect(userWsCols).toEqual(['user_id', 'workspace_id']);

    const wsStatusCols = res.rows
      .filter((r) => r.index_name === 'idx_workspace_memberships_workspace_status')
      .map((r) => r.column_name);
    expect(wsStatusCols).toEqual(['workspace_id', 'status']);
  });

  it('proves membership foreign keys use ON DELETE RESTRICT (or blocking NO ACTION) and do not cascade', async () => {
    const res = await client.query<{
      conname: string;
      confdeltype: string;
    }>(`
      SELECT
        conname,
        confdeltype
      FROM pg_constraint
      WHERE conrelid = 'workspace_memberships'::regclass
        AND contype = 'f'
      ORDER BY conname;
    `);

    expect(res.rows).toHaveLength(3);
    for (const fk of res.rows) {
      expect(['r', 'a']).toContain(fk.confdeltype);
    }
  });

  it('behaviorally proves deleting referenced workspace or user rows is blocked while memberships reference them', async () => {
    const uId = '0192b012-3456-789a-8bcd-ef0123456791';
    const inviterId = '0192b012-3456-789a-8bcd-ef0123456792';
    const wId = '0192b012-3456-789a-8bcd-ef0123456793';
    const mId = '0192b012-3456-789a-8bcd-ef0123456794';
    const nowIso = '2026-10-25T12:00:00.000Z';

    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'idp.example.com', 'user-del-1', null, null, 'active', $3, $3, 1),
              ($2, 'idp.example.com', 'user-del-2', null, null, 'active', $3, $3, 1);`,
      [uId, inviterId, nowIso],
    );

    await client.query(
      `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
       VALUES ($1, 'Del WS', 'del-ws-test', 'UTC', null, null, false, 'active', $2, $2, 1);`,
      [wId, nowIso],
    );

    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
       VALUES ($1, $2, $3, 'editor', 'active', $4, $5, $5, $5, 1);`,
      [mId, wId, uId, inviterId, nowIso],
    );

    // Attempting to delete workspace must be blocked
    await expect(client.query('DELETE FROM workspaces WHERE id = $1;', [wId])).rejects.toThrow(
      /workspace_memberships_workspace_id_fkey/,
    );

    // Attempting to delete member user must be blocked
    await expect(client.query('DELETE FROM users WHERE id = $1;', [uId])).rejects.toThrow(
      /workspace_memberships_user_id_fkey/,
    );

    // Attempting to delete inviter user must be blocked
    await expect(client.query('DELETE FROM users WHERE id = $1;', [inviterId])).rejects.toThrow(
      /workspace_memberships_invited_by_user_id_fkey/,
    );
  });

  describe('users table constraints independently', () => {
    const validUserId = '0192b012-3456-789a-8bcd-ef0123456701';
    const validTime = new Date().toISOString();

    beforeAll(async () => {
      // Seed a baseline valid user
      await client.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ($1, 'issuer.example.com', 'sub1', 'u1@example.com', 'User 1', 'active', $2, $2, 1);`,
        [validUserId, validTime],
      );
    });

    it('rejects duplicate (identity_provider, identity_subject)', async () => {
      await expect(
        client.query(
          `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456702', 'issuer.example.com', 'sub1', 'other@example.com', 'User 2', 'active', $1, $1, 1);`,
          [validTime],
        ),
      ).rejects.toThrow(/users_identity_provider_subject_unique/);
    });

    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('rejects empty/whitespace identity_provider: %s', async (_, badProvider) => {
      await expect(
        client.query(
          `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456703', $1, 'sub3', null, null, 'active', $2, $2, 1);`,
          [badProvider, validTime],
        ),
      ).rejects.toThrow(/users_identity_provider_not_empty_check/);
    });

    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('rejects empty/whitespace identity_subject: %s', async (_, badSubject) => {
      await expect(
        client.query(
          `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456704', 'issuer.example.com', $1, null, null, 'active', $2, $2, 1);`,
          [badSubject, validTime],
        ),
      ).rejects.toThrow(/users_identity_subject_not_empty_check/);
    });

    it.each([
      ['archived', 'archived'],
      ['pending', 'pending'],
      ['deleted', 'deleted'],
      ['empty string', ''],
    ])('rejects each invalid status: %s', async (_, badStatus) => {
      await expect(
        client.query(
          `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456705', 'issuer.example.com', 'sub_status', null, null, $1, $2, $2, 1);`,
          [badStatus, validTime],
        ),
      ).rejects.toThrow(/users_status_check/);
    });

    it.each([
      ['version 0', 0],
      ['negative version -1', -1],
    ])('rejects invalid version: %s', async (_, badVersion) => {
      await expect(
        client.query(
          `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456706', 'issuer.example.com', 'sub_ver', null, null, 'active', $1, $1, $2);`,
          [validTime, badVersion],
        ),
      ).rejects.toThrow(/users_version_check/);
    });

    it('rejects updated_at < created_at', async () => {
      await expect(
        client.query(
          `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456707', 'issuer.example.com', 'sub_time', null, null, 'active', '2026-10-25T12:00:00Z', '2026-10-24T12:00:00Z', 1);`,
        ),
      ).rejects.toThrow(/users_updated_at_check/);
    });
  });

  describe('workspaces table constraints independently', () => {
    const validWsId = '0192b012-3456-789a-8bcd-ef0123456711';
    const validTime = new Date().toISOString();

    beforeAll(async () => {
      await client.query(
        `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
         VALUES ($1, 'Acme Main', 'acme-main', 'UTC', null, null, false, 'active', $2, $2, 1);`,
        [validWsId, validTime],
      );
    });

    it('rejects duplicate normalized/canonical slug', async () => {
      await expect(
        client.query(
          `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456712', 'Acme Duplicate', 'acme-main', 'UTC', null, null, false, 'active', $1, $1, 1);`,
          [validTime],
        ),
      ).rejects.toThrow(/workspaces_slug_unique/);
    });

    const invalidSlugs: Array<[string, string]> = [
      ['uppercase', 'ACME'],
      ['repeated hyphen', 'acme--main'],
      ['leading hyphen', '-acme'],
      ['trailing hyphen', 'acme-'],
      ['underscore', 'acme_main'],
      ['exclamation punctuation', 'acme!main'],
      ['dot punctuation', 'acme.main'],
      ['Unicode confusable', 'аcme'],
      ['contains space', 'acme main'],
      ['leading space', ' acme'],
      ['trailing space', 'acme '],
    ];

    it.each(invalidSlugs)('rejects slug violation: %s (%s)', async (_, badSlug) => {
      await expect(
        client.query(
          `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456713', 'Bad Slug', $1, 'UTC', null, null, false, 'active', $2, $2, 1);`,
          [badSlug, validTime],
        ),
      ).rejects.toThrow(/workspaces_slug_format_check/);
    });

    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('rejects empty/whitespace name: %s', async (_, badName) => {
      await expect(
        client.query(
          `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456714', $1, 'empty-name-ws', 'UTC', null, null, false, 'active', $2, $2, 1);`,
          [badName, validTime],
        ),
      ).rejects.toThrow(/workspaces_name_not_empty_check/);
    });

    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('rejects empty/whitespace timezone: %s', async (_, badTz) => {
      await expect(
        client.query(
          `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456715', 'Valid Name', 'empty-tz-ws', $1, null, null, false, 'active', $2, $2, 1);`,
          [badTz, validTime],
        ),
      ).rejects.toThrow(/workspaces_timezone_not_empty_check/);
    });

    it.each([
      ['pending', 'pending'],
      ['archived', 'archived'],
      ['deleted', 'deleted'],
      ['empty string', ''],
    ])('rejects invalid workspace status: %s', async (_, badStatus) => {
      await expect(
        client.query(
          `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456716', 'Bad Status WS', 'bad-status-ws', 'UTC', null, null, false, $1, $2, $2, 1);`,
          [badStatus, validTime],
        ),
      ).rejects.toThrow(/workspaces_status_check/);
    });

    it.each([
      ['version 0', 0],
      ['negative version -1', -1],
    ])('rejects invalid version on workspace: %s', async (_, badVersion) => {
      await expect(
        client.query(
          `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456717', 'Ver WS', 'ver-ws', 'UTC', null, null, false, 'active', $1, $1, $2);`,
          [validTime, badVersion],
        ),
      ).rejects.toThrow(/workspaces_version_check/);
    });

    it('rejects updated_at < created_at on workspace', async () => {
      await expect(
        client.query(
          `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456718', 'Time WS', 'time-ws', 'UTC', null, null, false, 'active', '2026-10-25T12:00:00Z', '2026-10-24T12:00:00Z', 1);`,
        ),
      ).rejects.toThrow(/workspaces_updated_at_check/);
    });
  });

  describe('workspace_memberships table constraints independently', () => {
    const validUserId = '0192b012-3456-789a-8bcd-ef0123456701';
    const validWsId = '0192b012-3456-789a-8bcd-ef0123456711';
    const validMemId = '0192b012-3456-789a-8bcd-ef0123456721';
    const validTime = new Date().toISOString();

    beforeAll(async () => {
      await client.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
         VALUES ($1, $2, $3, 'owner', 'active', null, $4, $4, $4, 1);`,
        [validMemId, validWsId, validUserId, validTime],
      );
    });

    it('rejects duplicate (workspace_id, user_id)', async () => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456722', $1, $2, 'editor', 'active', null, $3, $3, $3, 1);`,
          [validWsId, validUserId, validTime],
        ),
      ).rejects.toThrow(/workspace_memberships_workspace_user_unique/);
    });

    it('rejects duplicate membership primary key', async () => {
      // Use another valid user and workspace
      const otherUserId = '0192b012-3456-789a-8bcd-ef0123456788';
      await client.query(
        `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
         VALUES ($1, 'idp.example.com', 'other-sub', null, null, 'active', $2, $2, 1);`,
        [otherUserId, validTime],
      );

      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ($1, $2, $3, 'editor', 'active', null, $4, $4, $4, 1);`,
          [validMemId, validWsId, otherUserId, validTime],
        ),
      ).rejects.toThrow(/workspace_memberships_pkey/);
    });

    it.each([
      ['admin', 'admin'],
      ['member', 'member'],
      ['guest', 'guest'],
      ['empty string', ''],
    ])('rejects invalid role: %s', async (_, badRole) => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456723', $1, '0192b012-3456-789a-8bcd-ef0123456788', $2, 'active', null, $3, $3, $3, 1);`,
          [validWsId, badRole, validTime],
        ),
      ).rejects.toThrow(/workspace_memberships_role_check/);
    });

    it.each([
      ['pending', 'pending'],
      ['archived', 'archived'],
      ['deleted', 'deleted'],
      ['empty string', ''],
    ])('rejects invalid status: %s', async (_, badStatus) => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456724', $1, '0192b012-3456-789a-8bcd-ef0123456788', 'viewer', $2, null, $3, $3, $3, 1);`,
          [validWsId, badStatus, validTime],
        ),
      ).rejects.toThrow(/workspace_memberships_status_check/);
    });

    it('rejects active status with null joined_at', async () => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456725', $1, '0192b012-3456-789a-8bcd-ef0123456788', 'viewer', 'active', null, null, $2, $2, 1);`,
          [validWsId, validTime],
        ),
      ).rejects.toThrow(/workspace_memberships_active_joined_at_check/);
    });

    it.each([
      ['version 0', 0],
      ['negative version -1', -1],
    ])('rejects invalid version on membership: %s', async (_, badVersion) => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456726', $1, '0192b012-3456-789a-8bcd-ef0123456788', 'viewer', 'active', null, $2, $2, $2, $3);`,
          [validWsId, validTime, badVersion],
        ),
      ).rejects.toThrow(/workspace_memberships_version_check/);
    });

    it('rejects updated_at < created_at on membership', async () => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456727', $1, '0192b012-3456-789a-8bcd-ef0123456788', 'viewer', 'active', null, '2026-10-25T12:00:00Z', '2026-10-25T12:00:00Z', '2026-10-24T12:00:00Z', 1);`,
          [validWsId],
        ),
      ).rejects.toThrow(/workspace_memberships_updated_at_check/);
    });

    it('rejects missing workspace foreign key', async () => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456728', '0192b012-3456-789a-8bcd-ef0123456799', $1, 'owner', 'active', null, $2, $2, $2, 1);`,
          [validUserId, validTime],
        ),
      ).rejects.toThrow(/workspace_memberships_workspace_id_fkey/);
    });

    it('rejects missing user foreign key', async () => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456729', $1, '0192b012-3456-789a-8bcd-ef0123456799', 'owner', 'active', null, $2, $2, $2, 1);`,
          [validWsId, validTime],
        ),
      ).rejects.toThrow(/workspace_memberships_user_id_fkey/);
    });

    it('rejects missing inviter foreign key', async () => {
      await expect(
        client.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version)
           VALUES ('0192b012-3456-789a-8bcd-ef0123456730', $1, '0192b012-3456-789a-8bcd-ef0123456788', 'viewer', 'active', '0192b012-3456-789a-8bcd-ef0123456799', $2, $2, $2, 1);`,
          [validWsId, validTime],
        ),
      ).rejects.toThrow(/workspace_memberships_invited_by_user_id_fkey/);
    });
  });
});
