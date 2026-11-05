import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseIsoTimestamp,
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type WorkspaceMembershipSnapshot,
  type WorkspaceSnapshot,
} from '@affiliate-content-os/domain';
import {
  authorizeWorkspaceAction,
  SlugConflictError,
  WorkspaceAccessDeniedError,
  WorkspaceAuthorizationPersistenceError,
} from '@affiliate-content-os/application';
import { DatabaseError } from '../../src/database/errors.js';
import { createDatabase } from '../../src/database/index.js';
import { createPostgresTenancyAdapter } from '../../src/tenancy/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL Tenancy Adapter & Isolation Matrix Integration', () => {
  let context: TestDatabaseContext;
  let client: pg.Client;
  const nowIso = '2026-10-25T12:00:00.000Z';
  const now = parseIsoTimestamp(nowIso);

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

    // Seed active user
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version)
       VALUES ($1, 'idp.example.com', 'user-801', 'u801@example.com', 'User 801', 'active', $2, $2, 1);`,
      [userId, nowIso],
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

    const u1 = parseUserId('0192b012-3456-789a-8bcd-ef0123456811');
    const u2 = parseUserId('0192b012-3456-789a-8bcd-ef0123456812');
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version) VALUES
       ($1, 'idp.example.com', 'sub-811', null, null, 'active', $3, $3, 1),
       ($2, 'idp.example.com', 'sub-812', null, null, 'active', $3, $3, 1);`,
      [u1, u2, nowIso],
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

  it('proves duplicate membership unique violation maps to safe DatabaseError and NOT SlugConflictError in real PostgreSQL', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);

    const dupUserId = parseUserId('0192b012-3456-789a-8bcd-ef0123456891');
    const existingMemId = parseMembershipId('0192b012-3456-789a-8bcd-ef0123456892');
    const newWsId = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456893');

    // Seed active user
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version) VALUES
       ($1, 'idp.example.com', 'sub-dup-mem', null, null, 'active', $2, $2, 1);`,
      [dupUserId, nowIso],
    );

    // Seed an existing workspace with membership using existingMemId
    const seedWsId = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456894');
    await client.query(
      `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version) VALUES
       ($1, 'Seed WS', 'seed-ws-for-dup-mem', 'UTC', null, null, false, 'active', $2, $2, 1);`,
      [seedWsId, nowIso],
    );
    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version) VALUES
       ($1, $2, $3, 'owner', 'active', null, $4, $4, $4, 1);`,
      [existingMemId, seedWsId, dupUserId, nowIso],
    );

    // Attempt createWorkspaceWithOwner with new workspace but duplicate membership ID (violates workspace_memberships_pkey)
    const newWs: WorkspaceSnapshot = {
      id: newWsId,
      name: 'New WS With Dup Mem PK',
      slug: 'new-ws-dup-mem-pk',
      timezone: 'UTC',
      brandVoice: null,
      defaultDisclosure: null,
      aiEnabled: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const dupMem: WorkspaceMembershipSnapshot = {
      id: existingMemId, // Collides with existing membership PK!
      workspaceId: newWsId,
      userId: dupUserId,
      role: 'owner',
      status: 'active',
      invitedByUserId: null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const error = await adapter
      .createWorkspaceWithOwner({ workspace: newWs, membership: dupMem })
      .catch((e) => e);

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).not.toBeInstanceOf(SlugConflictError);

    // Verify new workspace was rolled back
    const checkWs = await client.query('SELECT id FROM workspaces WHERE id = $1;', [newWsId]);
    expect(checkWs.rows).toHaveLength(0);

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
      [userA, userB, userC, nowIso],
    );

    // Seed 2 workspaces
    await client.query(
      `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version) VALUES
       ($1, 'Workspace One', 'workspace-one', 'UTC', null, null, false, 'active', $3, $3, 1),
       ($2, 'Workspace Two', 'workspace-two', 'UTC', null, null, false, 'active', $3, $3, 1);`,
      [ws1, ws2, nowIso],
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
      [ws1, ws2, userA, userB, nowIso],
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

  it('proves workspace authorization boundary with PostgresTenancyAdapter against real PostgreSQL', async () => {
    const database = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      sslMode: 'disable',
    });
    const adapter = createPostgresTenancyAdapter(database);

    const userOwner = parseUserId('0192b012-3456-789a-8bcd-ef0123456851');
    const userEditor = parseUserId('0192b012-3456-789a-8bcd-ef0123456852');
    const userViewer = parseUserId('0192b012-3456-789a-8bcd-ef0123456853');
    const userSuspended = parseUserId('0192b012-3456-789a-8bcd-ef0123456854');
    const userRemoved = parseUserId('0192b012-3456-789a-8bcd-ef0123456855');
    const userUnrelated = parseUserId('0192b012-3456-789a-8bcd-ef0123456856');

    const wsAlpha = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456861');
    const wsBeta = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456862');

    // Seed users
    await client.query(
      `INSERT INTO users (id, identity_provider, identity_subject, email, display_name, status, created_at, updated_at, version) VALUES
       ($1, 'idp.example.com', 'user-owner', 'owner@example.com', 'Owner', 'active', $7, $7, 1),
       ($2, 'idp.example.com', 'user-editor', 'editor@example.com', 'Editor', 'active', $7, $7, 1),
       ($3, 'idp.example.com', 'user-viewer', 'viewer@example.com', 'Viewer', 'active', $7, $7, 1),
       ($4, 'idp.example.com', 'user-suspended', 'suspended@example.com', 'Suspended', 'active', $7, $7, 1),
       ($5, 'idp.example.com', 'user-removed', 'removed@example.com', 'Removed', 'active', $7, $7, 1),
       ($6, 'idp.example.com', 'user-unrelated', 'unrelated@example.com', 'Unrelated', 'active', $7, $7, 1);`,
      [userOwner, userEditor, userViewer, userSuspended, userRemoved, userUnrelated, nowIso],
    );

    // Seed workspaces
    await client.query(
      `INSERT INTO workspaces (id, name, slug, timezone, brand_voice, default_disclosure, ai_enabled, status, created_at, updated_at, version) VALUES
       ($1, 'Workspace Alpha', 'ws-alpha-auth', 'UTC', null, null, false, 'active', $3, $3, 1),
       ($2, 'Workspace Beta', 'ws-beta-auth', 'UTC', null, null, false, 'active', $3, $3, 1);`,
      [wsAlpha, wsBeta, nowIso],
    );

    // Seed memberships in wsAlpha
    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version) VALUES
       ('0192b012-3456-789a-8bcd-ef0123456871', $1, $2, 'owner', 'active', null, $7, $7, $7, 1),
       ('0192b012-3456-789a-8bcd-ef0123456872', $1, $3, 'editor', 'active', null, $7, $7, $7, 1),
       ('0192b012-3456-789a-8bcd-ef0123456873', $1, $4, 'viewer', 'active', null, $7, $7, $7, 1),
       ('0192b012-3456-789a-8bcd-ef0123456874', $1, $5, 'editor', 'suspended', null, $7, $7, $7, 1),
       ('0192b012-3456-789a-8bcd-ef0123456875', $1, $6, 'viewer', 'removed', null, $7, $7, $7, 1);`,
      [wsAlpha, userOwner, userEditor, userViewer, userSuspended, userRemoved, nowIso],
    );

    // 1. Role mapping without coercion and capability authorization
    // Owner can perform workspace.manage
    const ownerAuth = await authorizeWorkspaceAction(
      { workspaceId: wsAlpha, userId: userOwner, capability: 'workspace.manage' },
      { authorization: adapter },
    );
    expect(ownerAuth.role).toBe('owner');
    expect(ownerAuth.capability).toBe('workspace.manage');

    // Editor can perform content.manage but cannot perform workspace.manage
    const editorAuth = await authorizeWorkspaceAction(
      { workspaceId: wsAlpha, userId: userEditor, capability: 'content.manage' },
      { authorization: adapter },
    );
    expect(editorAuth.role).toBe('editor');
    expect(editorAuth.capability).toBe('content.manage');

    await expect(
      authorizeWorkspaceAction(
        { workspaceId: wsAlpha, userId: userEditor, capability: 'workspace.manage' },
        { authorization: adapter },
      ),
    ).rejects.toThrow(WorkspaceAccessDeniedError);

    // Viewer can perform catalog.read but cannot perform catalog.manage
    const viewerAuth = await authorizeWorkspaceAction(
      { workspaceId: wsAlpha, userId: userViewer, capability: 'catalog.read' },
      { authorization: adapter },
    );
    expect(viewerAuth.role).toBe('viewer');
    expect(viewerAuth.capability).toBe('catalog.read');

    await expect(
      authorizeWorkspaceAction(
        { workspaceId: wsAlpha, userId: userViewer, capability: 'catalog.manage' },
        { authorization: adapter },
      ),
    ).rejects.toThrow(WorkspaceAccessDeniedError);

    // 2. Cross-tenant isolation: userOwner in wsAlpha cannot authorize in wsBeta
    await expect(
      authorizeWorkspaceAction(
        { workspaceId: wsBeta, userId: userOwner, capability: 'workspace.read' },
        { authorization: adapter },
      ),
    ).rejects.toThrow(WorkspaceAccessDeniedError);

    // 3. Cross-user isolation: userUnrelated cannot use userOwner's membership in wsAlpha
    await expect(
      authorizeWorkspaceAction(
        { workspaceId: wsAlpha, userId: userUnrelated, capability: 'workspace.read' },
        { authorization: adapter },
      ),
    ).rejects.toThrow(WorkspaceAccessDeniedError);

    // 4. Suspended / removed membership is not returned as active authorization
    await expect(
      authorizeWorkspaceAction(
        { workspaceId: wsAlpha, userId: userSuspended, capability: 'workspace.read' },
        { authorization: adapter },
      ),
    ).rejects.toThrow(WorkspaceAccessDeniedError);

    await expect(
      authorizeWorkspaceAction(
        { workspaceId: wsAlpha, userId: userRemoved, capability: 'workspace.read' },
        { authorization: adapter },
      ),
    ).rejects.toThrow(WorkspaceAccessDeniedError);

    // 5. Unknown/malformed database rows fail safely through existing mapper guarantees
    // A non-UUIDv7 UUID (e.g. UUIDv4) is accepted by PostgreSQL UUID type, but rejected by UUIDv7 mapper guarantees
    const malformedMemId = '00000000-0000-4000-8000-000000000000';
    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status, invited_by_user_id, joined_at, created_at, updated_at, version) VALUES
       ($1, $2, $3, 'editor', 'active', null, $4, $4, $4, 1);`,
      [malformedMemId, wsBeta, userOwner, nowIso],
    );

    await expect(
      adapter.findMembership({ workspaceId: wsBeta, userId: userOwner }),
    ).rejects.toThrow();

    await expect(
      authorizeWorkspaceAction(
        { workspaceId: wsBeta, userId: userOwner, capability: 'workspace.read' },
        { authorization: adapter },
      ),
    ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);

    await database.close();
  });
});
