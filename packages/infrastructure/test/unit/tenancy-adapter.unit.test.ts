import { describe, expect, it } from 'vitest';
import {
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
import { createPostgresTenancyAdapter } from '../../src/tenancy/index.js';

class FakeDatabase implements Database {
  public queryCalls: Array<{ text: string; params?: readonly unknown[] | undefined }> = [];
  public queryResults: DatabaseQueryResult<unknown>[] = [];
  public txQueryCalls: Array<{ text: string; params?: readonly unknown[] | undefined }> = [];
  public txFailWith?: Error;

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
  const now = new Date('2026-10-25T12:00:00Z');

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
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
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

  it('maps unique constraint violation on slug to SlugConflictError', async () => {
    const fakeDb = new FakeDatabase();
    const pgUniqueError = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      {
        code: '23505',
        constraint: 'workspaces_slug_unique',
      },
    );
    fakeDb.txFailWith = pgUniqueError;

    const adapter = createPostgresTenancyAdapter(fakeDb);
    await expect(adapter.createWorkspaceWithOwner({ workspace, membership })).rejects.toThrow(
      SlugConflictError,
    );
  });

  it('sanitizes and wraps unexpected database errors in DatabaseError', async () => {
    const fakeDb = new FakeDatabase();
    fakeDb.txFailWith = new Error('Connection terminated postgresql://user:secret@127.0.0.1/db');

    const adapter = createPostgresTenancyAdapter(fakeDb);
    const err = await adapter.createWorkspaceWithOwner({ workspace, membership }).catch((e) => e);

    expect(err).toBeInstanceOf(DatabaseError);
    expect((err as Error).message).not.toContain('secret');
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
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
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
          joined_at: now.toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
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
