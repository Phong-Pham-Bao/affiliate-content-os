import { describe, expect, it } from 'vitest';
import {
  parseIsoTimestamp,
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type WorkspaceMembershipSnapshot,
  type WorkspaceSnapshot,
} from '@affiliate-content-os/domain';
import { SlugConflictError } from '@affiliate-content-os/application';
import { DatabaseError } from '../../src/database/errors.js';
import type {
  Database,
  DatabaseQueryResult,
  TransactionExecutor,
} from '../../src/database/types.js';
import {
  createPostgresTenancyAdapter,
  mapMembershipRow,
  mapUserRow,
  mapWorkspaceRow,
} from '../../src/tenancy/index.js';

class FakeDatabase implements Database {
  public queryCalls: Array<{ text: string; params?: readonly unknown[] | undefined }> = [];
  public queryResults: DatabaseQueryResult<unknown>[] = [];
  public txQueryCalls: Array<{ text: string; params?: readonly unknown[] | undefined }> = [];
  public txFailWith?: Error;
  public wsInsertFailWith?: Error;
  public memInsertFailWith?: Error;

  public async query<T = unknown>(
    text: string,
    params?: readonly unknown[],
  ): Promise<DatabaseQueryResult<T>> {
    this.queryCalls.push({ text, params });
    const result = this.queryResults.shift();
    if (!result) {
      return { rows: [], rowCount: 0, command: 'SELECT' };
    }
    return result as DatabaseQueryResult<T>;
  }

  public async withTransaction<T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T> {
    if (this.txFailWith) throw this.txFailWith;
    const tx: TransactionExecutor = {
      query: async <R = unknown>(
        text: string,
        params?: readonly unknown[],
      ): Promise<DatabaseQueryResult<R>> => {
        this.txQueryCalls.push({ text, params });
        if (text.includes('INSERT INTO workspaces') && this.wsInsertFailWith) {
          throw this.wsInsertFailWith;
        }
        if (text.includes('INSERT INTO workspace_memberships') && this.memInsertFailWith) {
          throw this.memInsertFailWith;
        }
        return { rows: [], rowCount: 1, command: 'INSERT' };
      },
    };
    return fn(tx);
  }

  public async probe(): Promise<void> {}
  public async close(): Promise<void> {}
  public isClosing(): boolean {
    return false;
  }
}

describe('PostgresTenancyAdapter Unit Tests', () => {
  const userId = parseUserId('0192b012-3456-789a-8bcd-ef0123456780');
  const workspaceId = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456781');
  const membershipId = parseMembershipId('0192b012-3456-789a-8bcd-ef0123456782');
  const nowIso = '2026-10-25T12:00:00.000Z';
  const now = parseIsoTimestamp(nowIso);

  const workspace: WorkspaceSnapshot = Object.freeze({
    id: workspaceId,
    name: 'Acme',
    slug: 'acme',
    timezone: 'UTC',
    brandVoice: null,
    defaultDisclosure: null,
    aiEnabled: false,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  const membership: WorkspaceMembershipSnapshot = Object.freeze({
    id: membershipId,
    workspaceId,
    userId,
    role: 'owner',
    status: 'active',
    invitedByUserId: null,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  it('findUserById returns mapped UserSnapshot when row found', async () => {
    const fakeDb = new FakeDatabase();
    fakeDb.queryResults.push({
      rows: [
        {
          id: userId,
          identity_provider: 'https://issuer.example.com',
          identity_subject: 'sub-42',
          email: 'user@example.com',
          display_name: 'Jane Doe',
          status: 'active',
          created_at: nowIso,
          updated_at: nowIso,
          version: '1',
        },
      ],
      rowCount: 1,
      command: 'SELECT',
    });

    const adapter = createPostgresTenancyAdapter(fakeDb);
    const user = await adapter.findUserById(userId);

    expect(user).toEqual({
      id: userId,
      identityProvider: 'https://issuer.example.com',
      identitySubject: 'sub-42',
      email: 'user@example.com',
      displayName: 'Jane Doe',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    expect(fakeDb.queryCalls[0]?.params).toEqual([userId]);
  });

  it('findUserById returns null when no row is found', async () => {
    const fakeDb = new FakeDatabase();
    const adapter = createPostgresTenancyAdapter(fakeDb);
    const user = await adapter.findUserById(userId);
    expect(user).toBeNull();
  });

  it('createWorkspaceWithOwner executes transaction and returns snapshots', async () => {
    const fakeDb = new FakeDatabase();
    const adapter = createPostgresTenancyAdapter(fakeDb);

    const result = await adapter.createWorkspaceWithOwner({ workspace, membership });

    expect(result.workspace).toEqual(workspace);
    expect(result.membership).toEqual(membership);
    expect(fakeDb.txQueryCalls).toHaveLength(2);
    expect(fakeDb.txQueryCalls[0]?.params?.[0]).toBe(workspaceId);
    expect(fakeDb.txQueryCalls[1]?.params?.[0]).toBe(membershipId);
  });

  describe('Constraint mapping matrix (Finding 1)', () => {
    function makeUniqueViolation(constraintName?: unknown, code = '23505'): Error {
      return Object.assign(new Error('duplicate key value violates unique constraint'), {
        code,
        constraint: constraintName,
      });
    }

    it('maps workspaces_slug_unique from workspace-insert catch to SlugConflictError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.wsInsertFailWith = makeUniqueViolation('workspaces_slug_unique');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      await expect(adapter.createWorkspaceWithOwner({ workspace, membership })).rejects.toThrow(
        SlugConflictError,
      );
    });

    it('maps sanitized UNIQUE_VIOLATION with workspaces_slug_unique to SlugConflictError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.wsInsertFailWith = makeUniqueViolation('workspaces_slug_unique', 'UNIQUE_VIOLATION');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      await expect(adapter.createWorkspaceWithOwner({ workspace, membership })).rejects.toThrow(
        SlugConflictError,
      );
    });

    it('maps workspaces_slug_unique from outer catch to SlugConflictError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.txFailWith = makeUniqueViolation('workspaces_slug_unique');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      await expect(adapter.createWorkspaceWithOwner({ workspace, membership })).rejects.toThrow(
        SlugConflictError,
      );
    });

    it('rejects workspaces_pkey as safe DatabaseError, not SlugConflictError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.wsInsertFailWith = makeUniqueViolation('workspaces_pkey');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
    });

    it('rejects workspace_memberships_pkey as safe DatabaseError, not SlugConflictError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.memInsertFailWith = makeUniqueViolation('workspace_memberships_pkey');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
    });

    it('rejects workspace_memberships_workspace_user_unique as safe DatabaseError, not SlugConflictError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.memInsertFailWith = makeUniqueViolation('workspace_memberships_workspace_user_unique');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
    });

    it('rejects users_identity_provider_subject_unique as safe DatabaseError, not SlugConflictError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.txFailWith = makeUniqueViolation('users_identity_provider_subject_unique');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
    });

    it.each([
      ['missing constraint (undefined)', undefined],
      ['null constraint', null],
      ['numeric constraint', 12345],
      ['unknown constraint', 'some_unknown_unique_idx'],
      ['empty string constraint', ''],
    ])('rejects unique violation with %s as safe DatabaseError', async (_, constraint) => {
      const fakeDb = new FakeDatabase();
      fakeDb.wsInsertFailWith = makeUniqueViolation(constraint);

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
    });

    it('handles hostile getter/proxy constraint safely without executing trap', async () => {
      const fakeDb = new FakeDatabase();
      let getterCalled = false;
      const hostileErr = new Error('hostile');
      (hostileErr as unknown as { code: string }).code = '23505';
      Object.defineProperty(hostileErr, 'constraint', {
        get() {
          getterCalled = true;
          return 'workspaces_slug_unique';
        },
      });
      fakeDb.wsInsertFailWith = hostileErr;

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(getterCalled).toBe(false);
      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
    });

    it('sanitizes non-unique database failures to safe DatabaseError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.txFailWith = new Error('Connection terminated postgresql://user:secret@127.0.0.1/db');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
      expect((err as Error).message).not.toContain('secret');
    });
  });

  describe('Row Mappers and Timestamp Immutability (Finding 3)', () => {
    it('maps Date objects from postgres driver to canonical IsoTimestamp strings', () => {
      const date = new Date('2026-10-25T14:30:00.123Z');
      const mappedUser = mapUserRow({
        id: userId,
        identity_provider: 'idp',
        identity_subject: 'sub',
        email: null,
        display_name: null,
        status: 'active',
        created_at: date,
        updated_at: date,
        version: '1',
      });

      expect(typeof mappedUser.createdAt).toBe('string');
      expect(typeof mappedUser.updatedAt).toBe('string');
      expect(mappedUser.createdAt).toBe('2026-10-25T14:30:00.123Z');
      expect(mappedUser.updatedAt).toBe('2026-10-25T14:30:00.123Z');

      // Consumer mutating the original driver Date does not mutate snapshot
      date.setFullYear(2000);
      expect(mappedUser.createdAt).toBe('2026-10-25T14:30:00.123Z');
    });

    it('maps valid timestamp strings to canonical IsoTimestamp strings', () => {
      const mappedWs = mapWorkspaceRow({
        id: workspaceId,
        name: 'W1',
        slug: 'w1',
        timezone: 'UTC',
        brand_voice: null,
        default_disclosure: null,
        ai_enabled: false,
        status: 'active',
        created_at: '2026-10-25T14:30:00.000Z',
        updated_at: '2026-10-25T14:30:00.000Z',
        version: 1,
      });

      expect(mappedWs.createdAt).toBe('2026-10-25T14:30:00.000Z');
      expect(mappedWs.updatedAt).toBe('2026-10-25T14:30:00.000Z');
      expect(Object.isFrozen(mappedWs)).toBe(true);
    });

    it('maps membership row with nullable joined_at', () => {
      const mappedMem = mapMembershipRow({
        id: membershipId,
        workspace_id: workspaceId,
        user_id: userId,
        role: 'editor',
        status: 'suspended',
        invited_by_user_id: null,
        joined_at: null,
        created_at: '2026-10-25T14:30:00.000Z',
        updated_at: '2026-10-25T14:30:00.000Z',
        version: 1,
      });

      expect(mappedMem.joinedAt).toBeNull();
      expect(mappedMem.createdAt).toBe('2026-10-25T14:30:00.000Z');
    });

    it.each([
      ['invalid date object', new Date('invalid')],
      ['invalid date string', 'not-a-date'],
      ['number', 123456],
      ['null for non-null created_at', null],
    ])('rejects invalid timestamp value (%s) with DatabaseError', (_, invalidVal) => {
      expect(() =>
        mapUserRow({
          id: userId,
          identity_provider: 'idp',
          identity_subject: 'sub',
          email: null,
          display_name: null,
          status: 'active',
          created_at: invalidVal as unknown as string,
          updated_at: nowIso,
          version: '1',
        }),
      ).toThrow(DatabaseError);
    });
  });

  it('findWorkspaceByIdForUser queries with workspaceId and userId', async () => {
    const fakeDb = new FakeDatabase();
    fakeDb.queryResults.push({
      rows: [
        {
          id: workspaceId,
          name: 'Acme',
          slug: 'acme',
          timezone: 'UTC',
          brand_voice: null,
          default_disclosure: null,
          ai_enabled: false,
          status: 'active',
          created_at: nowIso,
          updated_at: nowIso,
          version: '1',
        },
      ],
      rowCount: 1,
      command: 'SELECT',
    });

    const adapter = createPostgresTenancyAdapter(fakeDb);
    const ws = await adapter.findWorkspaceByIdForUser({ workspaceId, userId });

    expect(ws).toEqual(workspace);
    expect(fakeDb.queryCalls[0]?.params).toEqual([workspaceId, userId]);
  });

  it('findMembership queries with workspaceId and userId', async () => {
    const fakeDb = new FakeDatabase();
    fakeDb.queryResults.push({
      rows: [
        {
          id: membershipId,
          workspace_id: workspaceId,
          user_id: userId,
          role: 'owner',
          status: 'active',
          invited_by_user_id: null,
          joined_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
          version: '1',
        },
      ],
      rowCount: 1,
      command: 'SELECT',
    });

    const adapter = createPostgresTenancyAdapter(fakeDb);
    const mem = await adapter.findMembership({ workspaceId, userId });

    expect(mem).toEqual(membership);
    expect(fakeDb.queryCalls[0]?.params).toEqual([workspaceId, userId]);
  });
});
