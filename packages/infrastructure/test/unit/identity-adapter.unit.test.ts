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

    it('rejects proxy-backed row immediately with zero traps executed', () => {
      let trapsCalled = 0;
      const handler: ProxyHandler<RawUserRow> = {
        get() {
          trapsCalled++;
          throw new Error('TRAP_GET');
        },
        getOwnPropertyDescriptor() {
          trapsCalled++;
          throw new Error('TRAP_DESC');
        },
        getPrototypeOf() {
          trapsCalled++;
          throw new Error('TRAP_PROTO');
        },
        ownKeys() {
          trapsCalled++;
          throw new Error('TRAP_OWNKEYS');
        },
        has() {
          trapsCalled++;
          throw new Error('TRAP_HAS');
        },
        isExtensible() {
          trapsCalled++;
          throw new Error('TRAP_EXTENSIBLE');
        },
        defineProperty() {
          trapsCalled++;
          throw new Error('TRAP_DEFINE');
        },
      };
      const proxyRow = new Proxy(createValidRawUserRow(), handler);
      expect(() => mapUserRow(proxyRow)).toThrow(DatabaseError);
      expect(trapsCalled).toBe(0);

      try {
        mapUserRow(proxyRow);
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).message).toBe('Failed to map user row');
      }
    });

    it('rejects revoked proxy row safely with zero traps executed', () => {
      let trapsCalled = 0;
      const { proxy, revoke } = Proxy.revocable(createValidRawUserRow(), {
        get() {
          trapsCalled++;
          throw new Error('TRAP_GET');
        },
        getOwnPropertyDescriptor() {
          trapsCalled++;
          throw new Error('TRAP_DESC');
        },
      });
      revoke();
      expect(() => mapUserRow(proxy)).toThrow(DatabaseError);
      expect(trapsCalled).toBe(0);
    });

    it('rejects row with custom prototype, symbol keys, extra keys, or missing keys', () => {
      class CustomRow {}
      const customProtoRow = Object.assign(new CustomRow(), createValidRawUserRow());
      expect(() => mapUserRow(customProtoRow as unknown as RawUserRow)).toThrow(DatabaseError);

      const symbolKeyRow = {
        ...createValidRawUserRow(),
        [Symbol('hostile')]: 'secret',
      };
      expect(() => mapUserRow(symbolKeyRow as unknown as RawUserRow)).toThrow(DatabaseError);

      const extraKeyRow = { ...createValidRawUserRow(), extra: 'forbidden' };
      expect(() => mapUserRow(extraKeyRow as unknown as RawUserRow)).toThrow(DatabaseError);

      const missingKeyRow = { ...createValidRawUserRow() };
      delete (missingKeyRow as Record<string, unknown>).status;
      expect(() => mapUserRow(missingKeyRow as unknown as RawUserRow)).toThrow(DatabaseError);

      const inheritedKeyRow = Object.create({ status: 'active' });
      Object.assign(inheritedKeyRow, createValidRawUserRow());
      delete inheritedKeyRow.status;
      expect(() => mapUserRow(inheritedKeyRow as unknown as RawUserRow)).toThrow(DatabaseError);
    });

    it('rejects non-object rows and primitives', () => {
      const invalidRows = [null, undefined, 123, 'row', true, [], () => {}, Symbol('row'), 99n];
      for (const invalid of invalidRows) {
        expect(() => mapUserRow(invalid as unknown as RawUserRow)).toThrow(DatabaseError);
      }
    });

    it('rejects getters and setters without executing getter code', () => {
      let getterCalled = false;
      const getterRow = {
        ...createValidRawUserRow(),
        get id() {
          getterCalled = true;
          return '018f6c38-7654-7123-8abc-def012345678';
        },
      };
      expect(() => mapUserRow(getterRow as unknown as RawUserRow)).toThrow(DatabaseError);
      expect(getterCalled).toBe(false);

      const setterRow = {
        ...createValidRawUserRow(),
        set id(_v: string) {},
      };
      expect(() => mapUserRow(setterRow as unknown as RawUserRow)).toThrow(DatabaseError);
    });

    it('accepts and converts valid number, string, and bigint versions to positive integer number', () => {
      const numMapped = mapUserRow(createValidRawUserRow({ version: 42 }));
      expect(numMapped.version).toBe(42);

      const maxNumMapped = mapUserRow(createValidRawUserRow({ version: Number.MAX_SAFE_INTEGER }));
      expect(maxNumMapped.version).toBe(Number.MAX_SAFE_INTEGER);

      const strMapped = mapUserRow(createValidRawUserRow({ version: '42' as unknown as number }));
      expect(strMapped.version).toBe(42);

      const maxStrMapped = mapUserRow(
        createValidRawUserRow({ version: '9007199254740991' as unknown as number }),
      );
      expect(maxStrMapped.version).toBe(Number.MAX_SAFE_INTEGER);

      const bigMapped = mapUserRow(createValidRawUserRow({ version: 42n as unknown as number }));
      expect(bigMapped.version).toBe(42);

      const maxBigMapped = mapUserRow(
        createValidRawUserRow({ version: BigInt(Number.MAX_SAFE_INTEGER) as unknown as number }),
      );
      expect(maxBigMapped.version).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects invalid numbers, non-canonical strings, and out-of-range bigints for version', () => {
      const invalidVersions = [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        '0',
        '01',
        '007',
        '+1',
        '-1',
        '1.0',
        '1e5',
        '9007199254740992',
        '999999999999999999',
        'invalid',
        ' 1 ',
        '',
        0n,
        -1n,
        BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        true,
        false,
        {},
        [],
        null,
        undefined,
        Symbol('v'),
      ];
      for (const v of invalidVersions) {
        expect(() =>
          mapUserRow(createValidRawUserRow({ version: v as unknown as number })),
        ).toThrow(DatabaseError);
      }
    });

    it('rejects invalid provider and subject values (empty, whitespace-padded, non-string)', () => {
      const invalidKeys = ['', '   ', ' idp', 'idp ', '  sub  ', 123, null, undefined, {}];
      for (const k of invalidKeys) {
        expect(() =>
          mapUserRow(createValidRawUserRow({ identity_provider: k as unknown as string })),
        ).toThrow(DatabaseError);
        expect(() =>
          mapUserRow(createValidRawUserRow({ identity_subject: k as unknown as string })),
        ).toThrow(DatabaseError);
      }
    });

    it('accepts string or null for email and displayName and rejects objects/booleans/numbers', () => {
      const mappedNull = mapUserRow(createValidRawUserRow({ email: null, display_name: null }));
      expect(mappedNull.email).toBeNull();
      expect(mappedNull.displayName).toBeNull();

      const invalidOptionals = [123, true, false, {}, [], Symbol('opt'), 10n, undefined];
      for (const opt of invalidOptionals) {
        expect(() =>
          mapUserRow(createValidRawUserRow({ email: opt as unknown as string })),
        ).toThrow(DatabaseError);
        expect(() =>
          mapUserRow(createValidRawUserRow({ display_name: opt as unknown as string })),
        ).toThrow(DatabaseError);
      }
    });

    it('validates created_at and updated_at with canonical string or genuine Date and rejects hostile Dates', () => {
      const genuineDate = new Date('2026-11-01T12:00:00.000Z');
      const mappedDate = mapUserRow(
        createValidRawUserRow({ created_at: genuineDate, updated_at: genuineDate }),
      );
      expect(mappedDate.createdAt).toBe('2026-11-01T12:00:00.000Z');
      expect(mappedDate.updatedAt).toBe('2026-11-01T12:00:00.000Z');

      let ownGetTimeCalled = false;
      const hostileDate = new Date('2026-11-01T12:00:00.000Z');
      hostileDate.getTime = () => {
        ownGetTimeCalled = true;
        return 0;
      };
      expect(() => mapUserRow(createValidRawUserRow({ created_at: hostileDate }))).toThrow(
        DatabaseError,
      );
      expect(ownGetTimeCalled).toBe(false);

      let ownIsoCalled = false;
      const hostileIsoDate = new Date('2026-11-01T12:00:00.000Z');
      hostileIsoDate.toISOString = () => {
        ownIsoCalled = true;
        return 'hostile';
      };
      expect(() => mapUserRow(createValidRawUserRow({ created_at: hostileIsoDate }))).toThrow(
        DatabaseError,
      );
      expect(ownIsoCalled).toBe(false);

      class HostileDateSubclass extends Date {}
      const subclassDate = new HostileDateSubclass();
      expect(() => mapUserRow(createValidRawUserRow({ created_at: subclassDate }))).toThrow(
        DatabaseError,
      );

      let proxyDateTrap = false;
      const proxyDate = new Proxy(new Date(), {
        get(t, p) {
          proxyDateTrap = true;
          return Reflect.get(t, p);
        },
      });
      expect(() => mapUserRow(createValidRawUserRow({ created_at: proxyDate }))).toThrow(
        DatabaseError,
      );
      expect(proxyDateTrap).toBe(false);

      const invalidDate = new Date('invalid');
      expect(() => mapUserRow(createValidRawUserRow({ created_at: invalidDate }))).toThrow(
        DatabaseError,
      );
    });

    it('never executes toString, valueOf, toJSON, or custom inspection hooks on unknown row values', () => {
      let hookExecuted = false;
      const hostileHookObject = {
        toString() {
          hookExecuted = true;
          return 'hook';
        },
        valueOf() {
          hookExecuted = true;
          return 1;
        },
        toJSON() {
          hookExecuted = true;
          return {};
        },
        [Symbol.iterator]() {
          hookExecuted = true;
          return [][Symbol.iterator]();
        },
        [Symbol.for('nodejs.util.inspect.custom')]() {
          hookExecuted = true;
          return 'hook';
        },
      };

      expect(() =>
        mapUserRow(createValidRawUserRow({ email: hostileHookObject as unknown as string })),
      ).toThrow(DatabaseError);
      expect(() =>
        mapUserRow(createValidRawUserRow({ version: hostileHookObject as unknown as number })),
      ).toThrow(DatabaseError);
      expect(() =>
        mapUserRow(createValidRawUserRow({ created_at: hostileHookObject as unknown as string })),
      ).toThrow(DatabaseError);
      expect(hookExecuted).toBe(false);
    });

    it('throws a fresh safe DatabaseError and never preserves crafted DatabaseError identity or secret', () => {
      const secretSentinel = 'postgresql://admin:super_secret_password@db.example.com/acos';
      const craftedError = new DatabaseError(secretSentinel, { code: 'DATABASE_ERROR' });
      const hostileRow = {
        ...createValidRawUserRow(),
        get status() {
          throw craftedError;
        },
      };

      let caughtError: unknown;
      try {
        mapUserRow(hostileRow as unknown as RawUserRow);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(DatabaseError);
      expect(caughtError).not.toBe(craftedError);
      const dbErr = caughtError as DatabaseError;
      expect(dbErr.message).toBe('Failed to map user row');
      expect(dbErr.message).not.toContain(secretSentinel);
      expect(dbErr.stack ?? '').not.toContain(secretSentinel);
      expect(String(dbErr)).not.toContain(secretSentinel);
      expect(JSON.stringify(dbErr)).not.toContain(secretSentinel);
    });

    it('proves hostile row sentinels never leak to child process stdout, stderr, or inspect', async () => {
      const { spawn } = await import('node:child_process');
      const sentinel = 'SECRET_ROW_CREDENTIAL_98765';
      const childScript = `
        import { mapUserRow } from './packages/infrastructure/src/tenancy/mappers.ts';
        import { DatabaseError } from './packages/infrastructure/src/database/errors.ts';
        import util from 'node:util';

        const crafted = new DatabaseError('${sentinel}');
        const hostileRow = {
          id: '018f6c38-7654-7123-8abc-def012345678',
          identity_provider: 'https://issuer.com',
          identity_subject: 'sub-1',
          email: null,
          display_name: null,
          status: 'active',
          created_at: '2026-11-01T00:00:00.000Z',
          updated_at: '2026-11-01T00:00:00.000Z',
          version: 1,
          get status() {
            throw crafted;
          }
        };

        try {
          mapUserRow(hostileRow as any);
          process.exit(1);
        } catch (err: any) {
          const str = String(err);
          const json = JSON.stringify(err);
          const insp1 = util.inspect(err, { customInspect: true });
          const insp2 = util.inspect(err, { customInspect: false });
          const out = str + json + insp1 + insp2 + (err.stack ?? '');
          if (out.includes('${sentinel}')) {
            process.exit(2);
          }
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
      expect(stdout).not.toContain(sentinel);
      expect(stderr).not.toContain(sentinel);
    }, 15000);
  });
});
