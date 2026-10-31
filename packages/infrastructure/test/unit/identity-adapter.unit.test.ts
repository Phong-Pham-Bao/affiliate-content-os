import { describe, expect, it } from 'vitest';
import { parseIsoTimestamp, parseUserId, type UserSnapshot } from '@affiliate-content-os/domain';
import { DatabaseError } from '../../src/database/errors.js';
import type {
  Database,
  DatabaseQueryResult,
  TransactionExecutor,
} from '../../src/database/types.js';
import {
  createPostgresTenancyAdapter,
  mapUserRow,
  type RawUserRow,
} from '../../src/tenancy/index.js';

class FakeIdentityDatabase implements Database {
  public isClosing(): boolean {
    return false;
  }
  public queryCalls: Array<{ text: string; params?: readonly unknown[] | undefined }> = [];
  public queryResults: DatabaseQueryResult<unknown>[] = [];

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

  public async withTransaction<T>(_fn: (tx: TransactionExecutor) => Promise<T>): Promise<T> {
    throw new Error('Not used in identity adapter unit tests');
  }

  public async probe(): Promise<void> {}
  public async close(): Promise<void> {}
}

function createValidRawUserRow(overrides: Partial<RawUserRow> = {}): RawUserRow {
  return {
    id: '018f6c38-7654-7123-8abc-def012345678',
    identity_provider: 'https://issuer.example.com',
    identity_subject: 'sub-100',
    email: 'user@example.com',
    display_name: 'Test User',
    status: 'active',
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('PostgresTenancyAdapter Identity Operations', () => {
  describe('findUsersByIdentity', () => {
    it('executes parameterized SELECT with LIMIT 2 and exact provider/subject parameters', async () => {
      const db = new FakeIdentityDatabase();
      const adapter = createPostgresTenancyAdapter(db);

      const rawRow = createValidRawUserRow();
      db.queryResults.push({
        rows: [rawRow],
        rowCount: 1,
        command: 'SELECT',
      });

      const users = await adapter.findUsersByIdentity({
        identityProvider: 'https://issuer.example.com',
        identitySubject: 'sub-100',
      });

      expect(db.queryCalls).toHaveLength(1);
      const call = db.queryCalls[0]!;
      expect(call.text).toContain(
        'SELECT id, identity_provider, identity_subject, email, display_name',
      );
      expect(call.text).toContain('FROM users');
      expect(call.text).toContain('WHERE identity_provider = $1');
      expect(call.text).toContain('AND identity_subject = $2');
      expect(call.text).toContain('LIMIT 2');
      expect(call.params).toEqual(['https://issuer.example.com', 'sub-100']);

      expect(users).toHaveLength(1);
      expect(users[0]!.id).toBe('018f6c38-7654-7123-8abc-def012345678');
      expect(Object.isFrozen(users)).toBe(true);
      expect(Object.isFrozen(users[0])).toBe(true);
    });

    it('returns empty array when 0 rows found', async () => {
      const db = new FakeIdentityDatabase();
      const adapter = createPostgresTenancyAdapter(db);

      db.queryResults.push({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
      });

      const users = await adapter.findUsersByIdentity({
        identityProvider: 'https://issuer.example.com',
        identitySubject: 'sub-nonexistent',
      });

      expect(users).toEqual([]);
      expect(Object.isFrozen(users)).toBe(true);
    });

    it('returns two mapped snapshots when 2 rows found without throwing in infrastructure', async () => {
      const db = new FakeIdentityDatabase();
      const adapter = createPostgresTenancyAdapter(db);

      const row1 = createValidRawUserRow();
      const row2 = createValidRawUserRow({ id: '018f6c38-7654-7123-8abc-def012345679' });
      db.queryResults.push({
        rows: [row1, row2],
        rowCount: 2,
        command: 'SELECT',
      });

      const users = await adapter.findUsersByIdentity({
        identityProvider: 'https://issuer.example.com',
        identitySubject: 'sub-100',
      });

      expect(users).toHaveLength(2);
      expect(users[0]!.id).toBe('018f6c38-7654-7123-8abc-def012345678');
      expect(users[1]!.id).toBe('018f6c38-7654-7123-8abc-def012345679');
    });

    it('fails safely with DatabaseError if any returned row is malformed', async () => {
      const db = new FakeIdentityDatabase();
      const adapter = createPostgresTenancyAdapter(db);

      const badRow = createValidRawUserRow({ status: 'invalid_status' });
      db.queryResults.push({
        rows: [badRow],
        rowCount: 1,
        command: 'SELECT',
      });

      await expect(
        adapter.findUsersByIdentity({
          identityProvider: 'https://issuer.example.com',
          identitySubject: 'sub-100',
        }),
      ).rejects.toThrow(DatabaseError);
    });
  });

  describe('insertUserIfAbsent', () => {
    it('executes parameterized INSERT with exact conflict target and 9 parameters', async () => {
      const db = new FakeIdentityDatabase();
      const adapter = createPostgresTenancyAdapter(db);

      const user: UserSnapshot = Object.freeze({
        id: parseUserId('018f6c38-7654-7123-8abc-def012345678'),
        identityProvider: 'https://issuer.example.com',
        identitySubject: 'sub-100',
        email: 'user@example.com',
        displayName: 'Test User',
        status: 'active',
        createdAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        version: 1,
      });

      const returnedRaw = createValidRawUserRow();
      db.queryResults.push({
        rows: [returnedRaw],
        rowCount: 1,
        command: 'INSERT',
      });

      const inserted = await adapter.insertUserIfAbsent({ user });

      expect(db.queryCalls).toHaveLength(1);
      const call = db.queryCalls[0]!;
      expect(call.text).toContain('INSERT INTO users');
      expect(call.text).toContain('ON CONFLICT (identity_provider, identity_subject) DO NOTHING');
      expect(call.text).toContain('RETURNING id, identity_provider, identity_subject');
      expect(call.params).toEqual([
        '018f6c38-7654-7123-8abc-def012345678',
        'https://issuer.example.com',
        'sub-100',
        'user@example.com',
        'Test User',
        'active',
        '2026-11-01T00:00:00.000Z',
        '2026-11-01T00:00:00.000Z',
        1,
      ]);

      expect(inserted).not.toBeNull();
      expect(inserted!.id).toBe('018f6c38-7654-7123-8abc-def012345678');
      expect(Object.isFrozen(inserted)).toBe(true);
    });

    it('returns null when 0 rows returned (ON CONFLICT DO NOTHING hit)', async () => {
      const db = new FakeIdentityDatabase();
      const adapter = createPostgresTenancyAdapter(db);

      const user: UserSnapshot = Object.freeze({
        id: parseUserId('018f6c38-7654-7123-8abc-def012345678'),
        identityProvider: 'https://issuer.example.com',
        identitySubject: 'sub-100',
        email: null,
        displayName: null,
        status: 'active',
        createdAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        version: 1,
      });

      db.queryResults.push({
        rows: [],
        rowCount: 0,
        command: 'INSERT',
      });

      const inserted = await adapter.insertUserIfAbsent({ user });
      expect(inserted).toBeNull();
    });

    it('throws safe DatabaseError when more than 1 row returned from insert', async () => {
      const db = new FakeIdentityDatabase();
      const adapter = createPostgresTenancyAdapter(db);

      const user: UserSnapshot = Object.freeze({
        id: parseUserId('018f6c38-7654-7123-8abc-def012345678'),
        identityProvider: 'https://issuer.example.com',
        identitySubject: 'sub-100',
        email: null,
        displayName: null,
        status: 'active',
        createdAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        version: 1,
      });

      const r1 = createValidRawUserRow();
      const r2 = createValidRawUserRow({ id: '018f6c38-7654-7123-8abc-def012345679' });
      db.queryResults.push({
        rows: [r1, r2],
        rowCount: 2,
        command: 'INSERT',
      });

      await expect(adapter.insertUserIfAbsent({ user })).rejects.toThrow(DatabaseError);
    });
  });

  describe('mapUserRow validation hardening', () => {
    it('accepts and maps valid user row to frozen UserSnapshot', () => {
      const raw = createValidRawUserRow();
      const mapped = mapUserRow(raw);
      expect(mapped.id).toBe('018f6c38-7654-7123-8abc-def012345678');
      expect(mapped.identityProvider).toBe('https://issuer.example.com');
      expect(mapped.identitySubject).toBe('sub-100');
      expect(mapped.status).toBe('active');
      expect(mapped.version).toBe(1);
      expect(Object.isFrozen(mapped)).toBe(true);
    });

    it('rejects invalid status with safe DatabaseError', () => {
      const raw = createValidRawUserRow({ status: 'admin' });
      expect(() => mapUserRow(raw)).toThrow(DatabaseError);
    });

    it('rejects invalid version (non-integer, <= 0) with safe DatabaseError', () => {
      expect(() => mapUserRow(createValidRawUserRow({ version: 0 }))).toThrow(DatabaseError);
      expect(() => mapUserRow(createValidRawUserRow({ version: -5 }))).toThrow(DatabaseError);
      expect(() => mapUserRow(createValidRawUserRow({ version: 1.5 }))).toThrow(DatabaseError);
      expect(() => mapUserRow(createValidRawUserRow({ version: 'invalid' }))).toThrow(
        DatabaseError,
      );
    });

    it('rejects invalid UUIDv7 id with safe DatabaseError', () => {
      const raw = createValidRawUserRow({ id: 'not-a-uuid' });
      expect(() => mapUserRow(raw)).toThrow(DatabaseError);
    });
  });
});
