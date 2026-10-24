import { spawn } from 'node:child_process';
import util from 'node:util';
import type { DatabaseConfig } from '@affiliate-content-os/config';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/database/database.js';
import { DatabaseError, sanitizeDatabaseError } from '../../src/database/errors.js';

const dummyConfig: DatabaseConfig = {
  databaseUrl: 'postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev',
  poolMax: 5,
  connectionTimeoutMs: 5000,
  idleTimeoutMs: 30000,
  statementTimeoutMs: 15000,
  sslMode: 'disable',
};

const sentinels = ['raw_user', 'raw_pass_secret', '10.88.77.66', 'raw_target_db'];
const secretUrl = 'postgresql://raw_user:raw_pass_secret@10.88.77.66:5432/raw_target_db';

function createHostileGetterError() {
  let codeCalls = 0;
  let messageCalls = 0;
  const err = {
    name: 'HostileError',
    get code() {
      codeCalls++;
      throw new Error(`Code getter explosion with ${secretUrl}`);
    },
    get message() {
      messageCalls++;
      throw new Error(`Message getter explosion with ${secretUrl}`);
    },
  };
  return { err, getCodeCalls: () => codeCalls, getMessageCalls: () => messageCalls };
}

function createHostileProxyError() {
  let trapCalls = 0;
  const target = new Error('Proxy target');
  const proxy = new Proxy(target, {
    get(_t, prop) {
      trapCalls++;
      throw new Error(`Proxy trap get [${String(prop)}] with ${secretUrl}`);
    },
    getOwnPropertyDescriptor(_t, _prop) {
      trapCalls++;
      throw new Error(`Proxy trap getOwnPropertyDescriptor with ${secretUrl}`);
    },
  });
  return { proxy, getTrapCalls: () => trapCalls };
}

function createHostilePrototypeProxyError() {
  let getCalls = 0;
  let getProtoCalls = 0;
  let ownKeysCalls = 0;
  let getDescCalls = 0;
  const proxy = new Proxy(
    {},
    {
      get(_t, prop) {
        getCalls++;
        throw new Error(`Proxy trap get [${String(prop)}] with ${secretUrl}`);
      },
      getPrototypeOf() {
        getProtoCalls++;
        throw new Error(`Proxy trap getPrototypeOf with ${secretUrl}`);
      },
      ownKeys() {
        ownKeysCalls++;
        throw new Error(`Proxy trap ownKeys with ${secretUrl}`);
      },
      getOwnPropertyDescriptor() {
        getDescCalls++;
        throw new Error(`Proxy trap getOwnPropertyDescriptor with ${secretUrl}`);
      },
    },
  );
  const err = Object.create(proxy);
  return {
    err,
    proxy,
    getTraps: () => ({
      get: getCalls,
      getPrototypeOf: getProtoCalls,
      ownKeys: ownKeysCalls,
      getOwnPropertyDescriptor: getDescCalls,
    }),
  };
}

function assertSafeDatabaseError(err: unknown, original: unknown) {
  expect(err === original).toBe(false);
  expect(err).toBeInstanceOf(DatabaseError);
  const dbErr = err as DatabaseError;
  expect(dbErr.cause).toBeUndefined();

  for (const key of Reflect.ownKeys(dbErr)) {
    expect((dbErr as unknown as Record<string | symbol, unknown>)[key] === original).toBe(false);
  }

  const msg = dbErr.message;
  const stack = dbErr.stack ?? '';
  const stringified = String(dbErr);
  const inspected = util.inspect(dbErr);
  const json = JSON.stringify(dbErr);

  for (const s of sentinels) {
    expect(msg).not.toContain(s);
    expect(stack).not.toContain(s);
    expect(stringified).not.toContain(s);
    expect(inspected).not.toContain(s);
    if (json) {
      expect(json).not.toContain(s);
    }
  }
}

describe('Finding 2: Hostile Raw Database-Error Classification Regression Coverage', () => {
  describe('direct sanitizeDatabaseError robustness', () => {
    it('classifies error with hostile getters as safe DatabaseError without executing getters', () => {
      const { err, getCodeCalls, getMessageCalls } = createHostileGetterError();
      const sanitized = sanitizeDatabaseError(err, 'Direct context');

      assertSafeDatabaseError(sanitized, err);
      expect(getCodeCalls()).toBe(0);
      expect(getMessageCalls()).toBe(0);
      expect(sanitized.code).toBe('DATABASE_ERROR');
      expect(sanitized.message).toBe('Direct context: Database operation failed');
    });

    it('classifies throwing Proxy error as safe DatabaseError without escaping exceptions', () => {
      const { proxy } = createHostileProxyError();
      const sanitized = sanitizeDatabaseError(proxy, 'Proxy context');

      assertSafeDatabaseError(sanitized, proxy);
      expect(sanitized.code).toBe('DATABASE_ERROR');
      expect(sanitized.message).toBe('Proxy context: Database operation failed');
    });

    it('safely handles DatabaseError with tampered hostile getters', () => {
      const tampered = new DatabaseError('Initial msg');
      Object.defineProperty(tampered, 'message', {
        get() {
          throw new Error(`Hostile message getter with ${secretUrl}`);
        },
      });

      const sanitized = sanitizeDatabaseError(tampered, 'Tampered');
      assertSafeDatabaseError(sanitized, tampered);
      expect(sanitized.code).toBe('DATABASE_ERROR');
    });
  });

  describe('database.query path', () => {
    it('handles hostile getter error in database.query', async () => {
      const { err, getCodeCalls, getMessageCalls } = createHostileGetterError();
      const mockPool = {
        query: vi.fn(async () => {
          throw err;
        }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.query('SELECT 1');
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      expect(getCodeCalls()).toBe(0);
      expect(getMessageCalls()).toBe(0);
    });

    it('handles throwing Proxy error in database.query', async () => {
      const { proxy } = createHostileProxyError();
      const mockPool = {
        query: vi.fn(async () => {
          throw proxy;
        }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.query('SELECT 1');
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, proxy);
    });
  });

  describe('database.probe path', () => {
    it('handles hostile getter error on pool.connect during probe', async () => {
      const { err, getCodeCalls } = createHostileGetterError();
      const mockPool = {
        connect: vi.fn(async () => {
          throw err;
        }),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.probe();
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      expect(getCodeCalls()).toBe(0);
    });

    it('handles throwing Proxy error on client.query during probe and releases client', async () => {
      const { proxy } = createHostileProxyError();
      const mockClient = {
        query: vi.fn(async () => {
          throw proxy;
        }),
        release: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockPool = {
        connect: vi.fn(async () => mockClient),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.probe();
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, proxy);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('pool connect for transaction path', () => {
    it('handles hostile getter error when acquiring client for transaction', async () => {
      const { err, getCodeCalls } = createHostileGetterError();
      const mockPool = {
        connect: vi.fn(async () => {
          throw err;
        }),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.withTransaction(async () => 'ok');
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      expect(getCodeCalls()).toBe(0);
    });
  });

  describe('transaction begin/query/commit/rollback path', () => {
    it('handles hostile getter error on BEGIN and releases client once', async () => {
      const { err, getCodeCalls } = createHostileGetterError();
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          if (sql === 'BEGIN') throw err;
          return { rows: [], rowCount: 0, command: 'SELECT' };
        }),
        release: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockPool = {
        connect: vi.fn(async () => mockClient),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.withTransaction(async () => 'ok');
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      expect(getCodeCalls()).toBe(0);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('handles throwing Proxy error on transaction query and rolls back and releases once', async () => {
      const { proxy } = createHostileProxyError();
      const queryList: string[] = [];
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          queryList.push(sql);
          if (sql.includes('SELECT sensitive')) throw proxy;
          return { rows: [], rowCount: 0, command: 'SELECT' };
        }),
        release: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockPool = {
        connect: vi.fn(async () => mockClient),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.withTransaction(async (tx) => {
          await tx.query('SELECT sensitive');
        });
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, proxy);
      expect(queryList).toContain('BEGIN');
      expect(queryList).toContain('ROLLBACK');
      expect(queryList).not.toContain('COMMIT');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('handles hostile getter error on COMMIT and rolls back and releases once', async () => {
      const { err, getCodeCalls } = createHostileGetterError();
      const queryList: string[] = [];
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          queryList.push(sql);
          if (sql === 'COMMIT') throw err;
          return { rows: [], rowCount: 0, command: 'SELECT' };
        }),
        release: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockPool = {
        connect: vi.fn(async () => mockClient),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.withTransaction(async () => 'ok');
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      expect(getCodeCalls()).toBe(0);
      expect(queryList).toContain('BEGIN');
      expect(queryList).toContain('COMMIT');
      expect(queryList).toContain('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('handles throwing Proxy error on ROLLBACK without replacing primary error', async () => {
      const { proxy } = createHostileProxyError();
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          if (sql === 'ROLLBACK') throw proxy;
          return { rows: [], rowCount: 0, command: 'SELECT' };
        }),
        release: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockPool = {
        connect: vi.fn(async () => mockClient),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.withTransaction(async () => {
          throw new Error('Primary safe error');
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('Primary safe error');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('client release path', () => {
    it('handles hostile getter error on client release and wraps in safe DatabaseError', async () => {
      const { err, getCodeCalls } = createHostileGetterError();
      const mockClient = {
        query: vi.fn(async () => ({ rows: [], rowCount: 0, command: 'SELECT' })),
        release: vi.fn(() => {
          throw err;
        }),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockPool = {
        connect: vi.fn(async () => mockClient),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.withTransaction(async () => 'ok');
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      expect(getCodeCalls()).toBe(0);
    });
  });

  describe('database.close path', () => {
    it('handles throwing Proxy error on database pool close', async () => {
      const { proxy } = createHostileProxyError();
      const mockPool = {
        connect: vi.fn(),
        query: vi.fn(),
        end: vi.fn(async () => {
          throw proxy;
        }),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.close();
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, proxy);
    });
  });

  describe('pool error handling path', () => {
    it('sanitizes hostile error emitted by pool error handler', () => {
      const { err, getCodeCalls } = createHostileGetterError();
      let capturedSafeError: Error | undefined;
      let poolErrorHandler: ((e: unknown) => void) | undefined;

      const mockPool = {
        connect: vi.fn(),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, handler: (e: unknown) => void) => {
          if (event === 'error') {
            poolErrorHandler = handler;
          }
        }),
      };

      createDatabase(dummyConfig, {
        poolFactory: () => mockPool as unknown as pg.Pool,
        onPoolError: (safeErr) => {
          capturedSafeError = safeErr;
        },
      });

      expect(poolErrorHandler).toBeDefined();
      poolErrorHandler!(err);

      expect(capturedSafeError).toBeDefined();
      assertSafeDatabaseError(capturedSafeError, err);
      expect(getCodeCalls()).toBe(0);
    });
  });

  describe('Case B: Ordinary object with Proxy prototype regression coverage', () => {
    it('sanitizes ordinary object with Proxy prototype in direct sanitizeDatabaseError with zero trap invocations', () => {
      const { err, getTraps } = createHostilePrototypeProxyError();
      const sanitized = sanitizeDatabaseError(err, 'Direct context');

      assertSafeDatabaseError(sanitized, err);
      const traps = getTraps();
      expect(traps.getPrototypeOf).toBe(0);
      expect(traps.ownKeys).toBe(0);
      expect(traps.getOwnPropertyDescriptor).toBe(0);
      expect(traps.get).toBe(0);
      expect(sanitized.code).toBe('DATABASE_ERROR');
      expect(sanitized.message).toBe('Direct context: Database operation failed');
    });

    it('handles ordinary object with Proxy prototype in database.query with zero trap invocations', async () => {
      const { err, getTraps } = createHostilePrototypeProxyError();
      const mockPool = {
        query: vi.fn(async () => {
          throw err;
        }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.query('SELECT 1');
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      const traps = getTraps();
      expect(traps.getPrototypeOf).toBe(0);
      expect(traps.ownKeys).toBe(0);
      expect(traps.getOwnPropertyDescriptor).toBe(0);
      expect(traps.get).toBe(0);
    });

    it('handles ordinary object with Proxy prototype in database.probe with zero trap invocations', async () => {
      const { err, getTraps } = createHostilePrototypeProxyError();
      const mockPool = {
        connect: vi.fn(async () => {
          throw err;
        }),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.probe();
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      const traps = getTraps();
      expect(traps.getPrototypeOf).toBe(0);
      expect(traps.ownKeys).toBe(0);
      expect(traps.getOwnPropertyDescriptor).toBe(0);
      expect(traps.get).toBe(0);
    });

    it('handles ordinary object with Proxy prototype in withTransaction connect failure with zero trap invocations', async () => {
      const { err, getTraps } = createHostilePrototypeProxyError();
      const mockPool = {
        connect: vi.fn(async () => {
          throw err;
        }),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.withTransaction(async () => 'ok');
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      const traps = getTraps();
      expect(traps.getPrototypeOf).toBe(0);
      expect(traps.ownKeys).toBe(0);
      expect(traps.getOwnPropertyDescriptor).toBe(0);
      expect(traps.get).toBe(0);
    });

    it('handles ordinary object with Proxy prototype in withTransaction tx.query failure with zero trap invocations', async () => {
      const { err, getTraps } = createHostilePrototypeProxyError();
      const mockClient = {
        query: vi.fn(async (text: string) => {
          if (text === 'SELECT 1') {
            throw err;
          }
          return { rows: [], rowCount: 0, command: 'SELECT' };
        }),
        release: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      const mockPool = {
        connect: vi.fn(async () => mockClient),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool as unknown as pg.Pool });

      let caught: unknown;
      try {
        await db.withTransaction(async (tx) => {
          await tx.query('SELECT 1');
        });
      } catch (e) {
        caught = e;
      }

      assertSafeDatabaseError(caught, err);
      const traps = getTraps();
      expect(traps.getPrototypeOf).toBe(0);
      expect(traps.ownKeys).toBe(0);
      expect(traps.getOwnPropertyDescriptor).toBe(0);
      expect(traps.get).toBe(0);
    });

    it('handles ordinary object with Proxy prototype in pool idle client error with zero trap invocations', () => {
      const { err, getTraps } = createHostilePrototypeProxyError();
      let capturedSafeError: Error | undefined;
      let poolErrorHandler: ((e: unknown) => void) | undefined;

      const mockPool = {
        connect: vi.fn(),
        query: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, handler: (e: unknown) => void) => {
          if (event === 'error') {
            poolErrorHandler = handler;
          }
        }),
      };

      createDatabase(dummyConfig, {
        poolFactory: () => mockPool as unknown as pg.Pool,
        onPoolError: (safeErr) => {
          capturedSafeError = safeErr;
        },
      });

      expect(poolErrorHandler).toBeDefined();
      poolErrorHandler!(err);

      expect(capturedSafeError).toBeDefined();
      assertSafeDatabaseError(capturedSafeError, err);
      const traps = getTraps();
      expect(traps.getPrototypeOf).toBe(0);
      expect(traps.ownKeys).toBe(0);
      expect(traps.getOwnPropertyDescriptor).toBe(0);
      expect(traps.get).toBe(0);
    });

    it('Case B child-process regression: ordinary object with Proxy prototype never triggers traps and no credential reaches stdout or stderr', async () => {
      const childScript = `
        import { sanitizeDatabaseError, DatabaseError } from './packages/infrastructure/src/database/errors.ts';
        let trapCalls = 0;
        const proxy = new Proxy({}, {
          get() { trapCalls++; console.error('${secretUrl}'); throw new Error('TRAP_GET'); },
          getPrototypeOf() { trapCalls++; console.error('${secretUrl}'); throw new Error('TRAP_GETPROTO'); },
          ownKeys() { trapCalls++; console.error('${secretUrl}'); throw new Error('TRAP_OWNKEYS'); },
          getOwnPropertyDescriptor() { trapCalls++; console.error('${secretUrl}'); throw new Error('TRAP_DESC'); },
        });
        const ordinaryErr = Object.create(proxy);
        const sanitized = sanitizeDatabaseError(ordinaryErr, 'ChildContext');
        if (sanitized instanceof DatabaseError && trapCalls === 0) {
          process.exit(0);
        }
        process.exit(2);
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
      const combinedOutput = stdout + stderr;
      for (const sentinel of sentinels) {
        expect(combinedOutput).not.toContain(sentinel);
      }
    });
  });
});
