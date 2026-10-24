import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type WorkspaceMembershipSnapshot,
  type WorkspaceSnapshot,
} from '@affiliate-content-os/domain';
import { SlugConflictError } from '@affiliate-content-os/application';
import { createDatabase } from '../../src/database/index.js';
import { createPostgresTenancyAdapter } from '../../src/tenancy/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL Tenancy Adapter & Isolation Matrix Integration', () => {
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

  it('atomically creates workspace and owner membership, rolling back on failure', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);

    const userId = parseUserId('0192b012-3456-789a-8bcd-ef0123456801');
    const wsId = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456802');
    const memId = parseMembershipId('0192b012-3456-789a-8bcd-ef0123456803');
    const now = new Date('2026-10-25T12:00:00Z');

    // Seed active user
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'idp.example.com', 'user-801', 'u801@example.com', 'User 801', 'active', $2, $2, 1);`,
      [userId, now.toISOString()],
    );

    const workspace: WorkspaceSnapshot = Object.freeze({
      id: wsId,
      name: 'Alpha Workspace',
      slug: 'alpha-workspace',
      timezone: 'UTC',
      brandVoice: 'Clear and concise',
      defaultDisclosure: '#ad',
      aiEnabled: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const membership: WorkspaceMembershipSnapshot = Object.freeze({
      id: memId,
      workspaceId: wsId,
      userId,
      role: 'owner',
      status: 'active',
      invitedByUserId: null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    // 1. Successful atomic creation
    const created = await adapter.createWorkspaceWithOwner({ workspace, membership });
    expect(created.workspace.id).toBe(wsId);
    expect(created.membership.id).toBe(memId);

    // Verify both rows exist in DB
    const wsCheck = await client.query('SELECT id FROM workspaces WHERE id = $1;', [wsId]);
    const memCheck = await client.query('SELECT id FROM workspace_memberships WHERE id = $1;', [
      memId,
    ]);
    expect(wsCheck.rows).toHaveLength(1);
    expect(memCheck.rows).toHaveLength(1);

    // 2. Forced rollback test: membership insert violates FK (non-existent user)
    const failWsId = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456804');
    const failMemId = parseMembershipId('0192b012-3456-789a-8bcd-ef0123456805');
    const nonExistentUserId = parseUserId('0192b012-3456-789a-8bcd-ef0123456899');

    await expect(
      adapter.createWorkspaceWithOwner({
        workspace: { ...workspace, id: failWsId, slug: 'failing-ws' },
        membership: {
          ...membership,
          id: failMemId,
          workspaceId: failWsId,
          userId: nonExistentUserId,
        },
      }),
    ).rejects.toThrow();

    // Verify workspace was rolled back and does NOT exist
    const rolledBackWs = await client.query('SELECT id FROM workspaces WHERE id = $1;', [failWsId]);
    expect(rolledBackWs.rows).toHaveLength(0);

    await database.close();
  });

  it('handles concurrent slug collisions by succeeding for one and throwing SlugConflictError for the other', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);
    const now = new Date('2026-10-25T12:00:00Z');

    const u1 = parseUserId('0192b012-3456-789a-8bcd-ef0123456811');
    const u2 = parseUserId('0192b012-3456-789a-8bcd-ef0123456812');
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version) VALUES
       ($1, 'idp.example.com', 'sub-811', null, null, 'active', $3, $3, 1),
       ($2, 'idp.example.com', 'sub-812', null, null, 'active', $3, $3, 1);`,
      [u1, u2, now.toISOString()],
    );

    const collisionSlug = 'colliding-workspace-slug';
    const ws1 = {
      id: parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456813'),
      name: 'W1',
      slug: collisionSlug,
      timezone: 'UTC',
      brandVoice: null,
      defaultDisclosure: null,
      aiEnabled: false,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const mem1 = {
      id: parseMembershipId('0192b012-3456-789a-8bcd-ef0123456814'),
      workspaceId: ws1.id,
      userId: u1,
      role: 'owner' as const,
      status: 'active' as const,
      invitedByUserId: null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const ws2 = {
      id: parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456815'),
      name: 'W2',
      slug: collisionSlug,
      timezone: 'UTC',
      brandVoice: null,
      defaultDisclosure: null,
      aiEnabled: false,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const mem2 = {
      id: parseMembershipId('0192b012-3456-789a-8bcd-ef0123456816'),
      workspaceId: ws2.id,
      userId: u2,
      role: 'owner' as const,
      status: 'active' as const,
      invitedByUserId: null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const results = await Promise.allSettled([
      adapter.createWorkspaceWithOwner({ workspace: ws1, membership: mem1 }),
      adapter.createWorkspaceWithOwner({ workspace: ws2, membership: mem2 }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SlugConflictError);

    await database.close();
  });

  it('enforces two-user two-workspace isolation matrix in both directions', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);
    const now = new Date('2026-10-25T12:00:00Z');

    const userA = parseUserId('0192b012-3456-789a-8bcd-ef0123456821');
    const userB = parseUserId('0192b012-3456-789a-8bcd-ef0123456822');
    const userC = parseUserId('0192b012-3456-789a-8bcd-ef0123456823');

    const ws1 = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456824');
    const ws2 = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456825');
    const nonExistentWs = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456829');

    // Seed 3 users
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version) VALUES
       ($1, 'idp.example.com', 'user-a', 'a@example.com', 'User A', 'active', $4, $4, 1),
       ($2, 'idp.example.com', 'user-b', 'b@example.com', 'User B', 'active', $4, $4, 1),
       ($3, 'idp.example.com', 'user-c', 'c@example.com', 'User C', 'active', $4, $4, 1);`,
      [userA, userB, userC, now.toISOString()],
    );

    // Seed 2 workspaces
    await client.query(
      `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version) VALUES
       ($1, 'Workspace One', 'workspace-one', 'UTC', null, null, false, 'active', $3, $3, 1),
       ($2, 'Workspace Two', 'workspace-two', 'UTC', null, null, false, 'active', $3, $3, 1);`,
      [ws1, ws2, now.toISOString()],
    );

    // Seed memberships:
    // User A: Active in Ws1, Suspended in Ws2
    // User B: Active in Ws2, Removed in Ws1
    // User C: None
    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version) VALUES
       ('0192b012-3456-789a-8bcd-ef0123456831', $1, $3, 'owner', 'active', null, $5, $5, $5, 1),
       ('0192b012-3456-789a-8bcd-ef0123456832', $2, $3, 'editor', 'suspended', null, $5, $5, $5, 1),
       ('0192b012-3456-789a-8bcd-ef0123456833', $2, $4, 'owner', 'active', null, $5, $5, $5, 1),
       ('0192b012-3456-789a-8bcd-ef0123456834', $1, $4, 'viewer', 'removed', null, $5, $5, $5, 1);`,
      [ws1, ws2, userA, userB, now.toISOString()],
    );

    // --- User A Reads ---
    const userA_ws1 = await adapter.findWorkspaceByIdForUser({ workspaceId: ws1, userId: userA });
    expect(userA_ws1?.id).toBe(ws1);
    const userA_ws2 = await adapter.findWorkspaceByIdForUser({ workspaceId: ws2, userId: userA });
    expect(userA_ws2).toBeNull(); // Suspended
    const userA_nonExistent = await adapter.findWorkspaceByIdForUser({
      workspaceId: nonExistentWs,
      userId: userA,
    });
    expect(userA_nonExistent).toBeNull();

    // --- User B Reads ---
    const userB_ws2 = await adapter.findWorkspaceByIdForUser({ workspaceId: ws2, userId: userB });
    expect(userB_ws2?.id).toBe(ws2);
    const userB_ws1 = await adapter.findWorkspaceByIdForUser({ workspaceId: ws1, userId: userB });
    expect(userB_ws1).toBeNull(); // Removed

    // --- User C (Unrelated) Reads ---
    const userC_ws1 = await adapter.findWorkspaceByIdForUser({ workspaceId: ws1, userId: userC });
    expect(userC_ws1).toBeNull();
    const userC_ws2 = await adapter.findWorkspaceByIdForUser({ workspaceId: ws2, userId: userC });
    expect(userC_ws2).toBeNull();

    // --- Membership Resolving Tests ---
    const memA_ws1 = await adapter.findMembership({ workspaceId: ws1, userId: userA });
    expect(memA_ws1?.role).toBe('owner');
    expect(memA_ws1?.status).toBe('active');

    const memA_ws2 = await adapter.findMembership({ workspaceId: ws2, userId: userA });
    expect(memA_ws2).toBeNull(); // Suspended returns null

    const memB_ws1 = await adapter.findMembership({ workspaceId: ws1, userId: userB });
    expect(memB_ws1).toBeNull(); // Removed returns null

    const memB_ws2 = await adapter.findMembership({ workspaceId: ws2, userId: userB });
    expect(memB_ws2?.role).toBe('owner');
    expect(memB_ws2?.status).toBe('active');

    const memC_ws1 = await adapter.findMembership({ workspaceId: ws1, userId: userC });
    expect(memC_ws1).toBeNull();

    await database.close();
  });
});
