import util from 'node:util';
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
    function makeUniqueViolation(constraintName?: unknown, ...codeArgs: [unknown?]): Error {
      const code = codeArgs.length > 0 ? codeArgs[0] : '23505';
      const err = new Error('duplicate key value violates unique constraint');
      Object.assign(err, { code, constraint: constraintName });
      return err;
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

    it('rejects workspaces_slug_unique reaching outer catch as safe DatabaseError without broad fallback', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.txFailWith = makeUniqueViolation('workspaces_slug_unique');

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
    });

    it('passes through previously constructed SlugConflictError from inner transaction boundary unchanged', async () => {
      const fakeDb = new FakeDatabase();
      const conflict = new SlugConflictError(workspace.slug);
      fakeDb.txFailWith = conflict;

      const adapter = createPostgresTenancyAdapter(fakeDb);
      await expect(adapter.createWorkspaceWithOwner({ workspace, membership })).rejects.toBe(
        conflict,
      );
    });

    it('rejects sanitized DatabaseError re-entering outer catch without raw metadata as safe DatabaseError', async () => {
      const fakeDb = new FakeDatabase();
      fakeDb.txFailWith = new DatabaseError('Transaction failed', { code: 'UNIQUE_VIOLATION' });

      const adapter = createPostgresTenancyAdapter(fakeDb);
      const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

      expect(err).toBeInstanceOf(DatabaseError);
      expect(err).not.toBeInstanceOf(SlugConflictError);
    });

    it('rejects workspaces_slug_unique with non-unique or invalid code as safe DatabaseError', async () => {
      const invalidCodes = ['42P01', '28P01', 'UNKNOWN_CODE', undefined, 12345, null];
      for (const code of invalidCodes) {
        const fakeDb = new FakeDatabase();
        fakeDb.wsInsertFailWith = makeUniqueViolation(
          'workspaces_slug_unique',
          code as unknown as string,
        );

        const adapter = createPostgresTenancyAdapter(fakeDb);
        const err = await adapter
          .createWorkspaceWithOwner({ workspace, membership })
          .catch((e) => e);

        expect(err).toBeInstanceOf(DatabaseError);
        expect(err).not.toBeInstanceOf(SlugConflictError);
      }
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

  describe('Row Mappers and Canonical Timestamp Matrix (Remediation 02 Finding 2)', () => {
    const validBaseUser = {
      id: userId,
      identity_provider: 'idp',
      identity_subject: 'sub',
      email: null,
      display_name: null,
      status: 'active',
      created_at: nowIso,
      updated_at: nowIso,
      version: '1',
    };

    const validBaseWs = {
      id: workspaceId,
      name: 'W1',
      slug: 'w1',
      timezone: 'UTC',
      brand_voice: null,
      default_disclosure: null,
      ai_enabled: false,
      status: 'active',
      created_at: nowIso,
      updated_at: nowIso,
      version: 1,
    };

    const validBaseMem = {
      id: membershipId,
      workspace_id: workspaceId,
      user_id: userId,
      role: 'editor',
      status: 'active',
      invited_by_user_id: null,
      joined_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
      version: 1,
    };

    const noncanonicalCases: [string, unknown][] = [
      ['missing milliseconds', '2026-10-25T12:00:00Z'],
      ['space-separated form', '2026-10-25 12:00:00+00'],
      ['explicit +00:00 offset', '2026-10-25T12:00:00.000+00:00'],
      ['non-zero timezone offset positive', '2026-10-25T12:00:00.000+07:00'],
      ['non-zero timezone offset negative', '2026-10-25T12:00:00.000-05:00'],
      ['lowercase z', '2026-10-25T12:00:00.000z'],
      ['extra fractional precision (4 digits)', '2026-10-25T12:00:00.1234Z'],
      ['extra fractional precision (6 digits)', '2026-10-25T12:00:00.123456Z'],
      ['shortened fractional precision (2 digits)', '2026-10-25T12:00:00.12Z'],
      ['shortened fractional precision (1 digit)', '2026-10-25T12:00:00.1Z'],
      ['surrounding whitespace leading', ' 2026-10-25T12:00:00.000Z'],
      ['surrounding whitespace trailing', '2026-10-25T12:00:00.000Z '],
      ['surrounding whitespace both', ' 2026-10-25T12:00:00.000Z '],
      ['date-only string', '2026-10-25'],
      ['numeric epoch string', '1792934400000'],
      ['numeric epoch number', 1792934400000],
      ['invalid calendar date (Feb 31)', '2026-02-31T12:00:00.000Z'],
      ['invalid month (13)', '2026-13-01T00:00:00.000Z'],
      ['invalid time (25:00:00)', '2026-10-25T25:00:00.000Z'],
      ['invalid date object', new Date('invalid')],
      ['arbitrary string', 'not-a-timestamp'],
      ['boolean true', true],
      ['boolean false', false],
      ['empty object', {}],
      ['empty array', []],
      ['null', null],
      ['undefined', undefined],
    ];

    describe.each([
      [
        'UserSnapshot.created_at',
        (val: unknown) => mapUserRow({ ...validBaseUser, created_at: val as unknown as string }),
        'created_at',
      ],
      [
        'UserSnapshot.updated_at',
        (val: unknown) => mapUserRow({ ...validBaseUser, updated_at: val as unknown as string }),
        'updated_at',
      ],
      [
        'WorkspaceSnapshot.created_at',
        (val: unknown) => mapWorkspaceRow({ ...validBaseWs, created_at: val as unknown as string }),
        'created_at',
      ],
      [
        'WorkspaceSnapshot.updated_at',
        (val: unknown) => mapWorkspaceRow({ ...validBaseWs, updated_at: val as unknown as string }),
        'updated_at',
      ],
      [
        'WorkspaceMembershipSnapshot.created_at',
        (val: unknown) =>
          mapMembershipRow({ ...validBaseMem, created_at: val as unknown as string }),
        'created_at',
      ],
      [
        'WorkspaceMembershipSnapshot.updated_at',
        (val: unknown) =>
          mapMembershipRow({ ...validBaseMem, updated_at: val as unknown as string }),
        'updated_at',
      ],
      [
        'WorkspaceMembershipSnapshot.joined_at (non-null)',
        (val: unknown) =>
          mapMembershipRow({ ...validBaseMem, joined_at: val as unknown as string }),
        'joined_at',
      ],
    ])('%s field validation', (_, mapperCall, fieldName) => {
      it.each(noncanonicalCases)(
        'rejects noncanonical timestamp (%s) as safe DatabaseError without leaking raw value',
        (_, val) => {
          // Skip null and undefined for nullable joined_at since null/undefined is allowed as null
          if (fieldName === 'joined_at' && (val === null || val === undefined)) {
            return;
          }

          let thrown: unknown;
          try {
            mapperCall(val);
          } catch (e) {
            thrown = e;
          }

          expect(thrown).toBeInstanceOf(DatabaseError);
          const dbErr = thrown as DatabaseError;
          expect(dbErr.message).toBe(`Invalid timestamp value for field "${fieldName}"`);

          if (typeof val === 'string' && val.length > 0) {
            expect(dbErr.message).not.toContain(val);
            expect(dbErr.stack ?? '').not.toContain(val);
            expect(String(dbErr)).not.toContain(val);
            expect(util.inspect(dbErr)).not.toContain(val);
            expect(JSON.stringify(dbErr)).not.toContain(val);
          }
        },
      );
    });

    it('preserves null for nullable WorkspaceMembershipSnapshot.joined_at', () => {
      const fromNull = mapMembershipRow({ ...validBaseMem, joined_at: null });
      expect(fromNull.joinedAt).toBeNull();

      const fromUndefined = mapMembershipRow({
        ...validBaseMem,
        joined_at: undefined as unknown as null,
      });
      expect(fromUndefined.joinedAt).toBeNull();
    });

    it.each([
      ['exact canonical string', '2026-10-25T12:00:00.000Z', '2026-10-25T12:00:00.000Z'],
      ['canonical string with non-zero ms', '2026-10-25T14:30:45.123Z', '2026-10-25T14:30:45.123Z'],
      ['canonical leap year date', '2028-02-29T23:59:59.999Z', '2028-02-29T23:59:59.999Z'],
      ['valid Date instance', new Date('2026-10-25T12:00:00.000Z'), '2026-10-25T12:00:00.000Z'],
      [
        'valid Date with milliseconds',
        new Date('2026-10-25T14:30:45.123Z'),
        '2026-10-25T14:30:45.123Z',
      ],
    ])('accepts canonical timestamp (%s) across all mappers', (_, input, expected) => {
      const u = mapUserRow({
        ...validBaseUser,
        created_at: input as unknown as string,
        updated_at: input as unknown as string,
      });
      expect(u.createdAt).toBe(expected);
      expect(u.updatedAt).toBe(expected);

      const w = mapWorkspaceRow({
        ...validBaseWs,
        created_at: input as unknown as string,
        updated_at: input as unknown as string,
      });
      expect(w.createdAt).toBe(expected);
      expect(w.updatedAt).toBe(expected);

      const m = mapMembershipRow({
        ...validBaseMem,
        joined_at: input as unknown as string,
        created_at: input as unknown as string,
        updated_at: input as unknown as string,
      });
      expect(m.joinedAt).toBe(expected);
      expect(m.createdAt).toBe(expected);
      expect(m.updatedAt).toBe(expected);
    });

    it('proves valid Date conversion is independent and immutable against driver mutation', () => {
      const mutableDriverDate = new Date('2026-10-25T12:00:00.000Z');
      const mapped = mapUserRow({
        ...validBaseUser,
        created_at: mutableDriverDate,
        updated_at: mutableDriverDate,
      });

      expect(mapped.createdAt).toBe('2026-10-25T12:00:00.000Z');
      expect(typeof mapped.createdAt).toBe('string');

      // Mutating driver Date object does not affect snapshot string
      mutableDriverDate.setFullYear(1999);
      mutableDriverDate.setHours(0);
      expect(mapped.createdAt).toBe('2026-10-25T12:00:00.000Z');
      expect(mapped.updatedAt).toBe('2026-10-25T12:00:00.000Z');
    });

    it('fails safely and completely when one timestamp field is invalid among otherwise valid fields', () => {
      expect(() =>
        mapUserRow({
          ...validBaseUser,
          created_at: '2026-10-25T12:00:00Z', // noncanonical missing ms
          updated_at: nowIso, // valid canonical
        }),
      ).toThrow(DatabaseError);

      expect(() =>
        mapUserRow({
          ...validBaseUser,
          created_at: nowIso, // valid canonical
          updated_at: '2026-10-25 12:00:00+00', // noncanonical space separated
        }),
      ).toThrow(DatabaseError);
    });

    it('proves rejected hostile timestamp value does not leak in child process output', async () => {
      const { spawn } = await import('node:child_process');
      const hostileValue =
        '2026-10-25T12:00:00Z; postgresql://hostile_user:secret_hostile_pass@10.99.88.77:5432/hostile_db';
      const childScript = `
        import { mapUserRow } from './packages/infrastructure/src/tenancy/mappers.ts';
        import util from 'node:util';
        try {
          mapUserRow({
            id: '0192b012-3456-789a-8bcd-ef0123456780',
            identity_provider: 'idp',
            identity_subject: 'sub',
            email: null,
            display_name: null,
            status: 'active',
            created_at: ${JSON.stringify(hostileValue)},
            updated_at: '2026-10-25T12:00:00.000Z',
            version: '1'
          });
          process.exit(1);
        } catch (err) {
          console.log(JSON.stringify(err));
          console.error(String(err));
          console.log(util.inspect(err));
          process.exit(0);
        }
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      const combined = stdout + stderr;
      expect(combined).not.toContain('hostile_user');
      expect(combined).not.toContain('secret_hostile_pass');
      expect(combined).not.toContain('10.99.88.77');
      expect(combined).not.toContain('hostile_db');
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
