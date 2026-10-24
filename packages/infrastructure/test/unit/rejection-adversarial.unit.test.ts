import { spawn } from 'node:child_process';
import util from 'node:util';
import type { DatabaseConfig } from '@affiliate-content-os/config';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/database/database.js';
import { DatabaseError } from '../../src/database/errors.js';

const dummyConfig: DatabaseConfig = {
  databaseUrl: 'postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev',
  poolMax: 5,
  connectionTimeoutMs: 5000,
  idleTimeoutMs: 30000,
  statementTimeoutMs: 15000,
  sslMode: 'disable',
};

function createMockPool() {
  const clientQueries: Array<{ text: string; params?: readonly unknown[] | undefined }> = [];
  const mockClient = {
    query: vi.fn(async (text: string, params?: readonly unknown[]) => {
      clientQueries.push({ text, params });
      return { rows: [], rowCount: 0, command: 'SELECT' };
    }),
    release: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn(async () => mockClient),
    query: vi.fn(async () => ({ rows: [], rowCount: 0, command: 'SELECT' })),
    end: vi.fn(async () => {}),
    on: vi.fn(),
  };

  return { mockPool: mockPool as unknown as pg.Pool, mockClient, clientQueries };
}

function assertSafeRejectionResult({
  caughtErr,
  originalErr,
  sentinels,
  clientQueries,
  mockClient,
  hookCounters,
}: {
  caughtErr: unknown;
  originalErr: unknown;
  sentinels: string[];
  clientQueries: Array<{ text: string }>;
  mockClient: { release: ReturnType<typeof vi.fn> };
  hookCounters: number[];
}) {
  for (const counter of hookCounters) {
    expect(counter).toBe(0);
  }

  expect(caughtErr === originalErr).toBe(false);
  expect(caughtErr).toBeInstanceOf(DatabaseError);
  const dbErr = caughtErr as DatabaseError;
  expect(dbErr.message).toBe('Transaction callback failed');
  expect(dbErr.cause).toBeUndefined();

  for (const key of Reflect.ownKeys(dbErr)) {
    expect((dbErr as unknown as Record<string | symbol, unknown>)[key] === originalErr).toBe(false);
  }

  const stringified = String(dbErr);
  const inspected = util.inspect(dbErr);
  const json = JSON.stringify(dbErr);
  for (const sentinel of sentinels) {
    expect(dbErr.message).not.toContain(sentinel);
    expect(dbErr.stack ?? '').not.toContain(sentinel);
    expect(stringified).not.toContain(sentinel);
    expect(inspected).not.toContain(sentinel);
    if (json) {
      expect(json).not.toContain(sentinel);
    }
  }

  const queryTexts = clientQueries.map((q) => q.text);
  expect(queryTexts).toContain('BEGIN');
  expect(queryTexts).toContain('ROLLBACK');
  expect(queryTexts).not.toContain('COMMIT');
  expect(mockClient.release).toHaveBeenCalledTimes(1);
}

describe('Finding 1: Adversarial Rejection Sanitization Tests', () => {
  const sentinels = ['hostile_user', 'hostile_password_secret', '10.99.88.77', 'hostile_tenant_db'];
  const secretUrl =
    'postgresql://hostile_user:hostile_password_secret@10.99.88.77:5432/hostile_tenant_db';

  it('replaces rejection with side-effecting getter without invoking it', async () => {
    let getterCalls = 0;
    const err = new Error('Base side-effecting error');
    Object.defineProperty(err, 'secretProp', {
      get() {
        getterCalls++;
        return secretUrl;
      },
      enumerable: true,
      configurable: true,
    });

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw err;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: err,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [getterCalls],
    });
  });

  it('replaces rejection with throwing getter without invoking it', async () => {
    let getterCalls = 0;
    const err = new Error('Base throwing error');
    Object.defineProperty(err, 'explodingProp', {
      get() {
        getterCalls++;
        throw new Error(`Explosion with ${secretUrl}`);
      },
      enumerable: true,
      configurable: true,
    });

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw err;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: err,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [getterCalls],
    });
  });

  it('replaces rejection with toJSON writing credentials to stderr without invoking it', async () => {
    let toJSONCalls = 0;
    const err = new Error('Base toJSON error');
    (err as unknown as Record<string, unknown>)['toJSON'] = () => {
      toJSONCalls++;
      console.error(`LEAK_STDERR: ${secretUrl}`);
      return { secret: secretUrl };
    };

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw err;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: err,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [toJSONCalls],
    });
  });

  it('replaces rejection with toString writing credentials without invoking it', async () => {
    let toStringCalls = 0;
    const err = new Error('Base toString error');
    err.toString = () => {
      toStringCalls++;
      console.error(`LEAK_STDERR: ${secretUrl}`);
      return `CustomToString: ${secretUrl}`;
    };

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw err;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: err,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [toStringCalls],
    });
  });

  it('replaces rejection with custom nodejs.util.inspect.custom hook without invoking it', async () => {
    let inspectCalls = 0;
    const err = new Error('Base custom inspect error');
    (err as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.inspect.custom')] = () => {
      inspectCalls++;
      console.error(`LEAK_STDERR: ${secretUrl}`);
      return `CustomInspect: ${secretUrl}`;
    };

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw err;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: err,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [inspectCalls],
    });
  });

  it('replaces rejection with inspect method without invoking it', async () => {
    let inspectCalls = 0;
    const err = new Error('Base inspect method error');
    (err as unknown as Record<string, unknown>)['inspect'] = () => {
      inspectCalls++;
      console.error(`LEAK_STDERR: ${secretUrl}`);
      return `Inspect: ${secretUrl}`;
    };

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw err;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: err,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [inspectCalls],
    });
  });

  it('replaces rejection with valueOf and Symbol.toPrimitive coercion hooks without invoking them', async () => {
    let valueOfCalls = 0;
    let toPrimitiveCalls = 0;
    const err = new Error('Base coercion error');
    (err as unknown as Record<string, unknown>)['valueOf'] = () => {
      valueOfCalls++;
      console.error(`LEAK_STDERR: ${secretUrl}`);
      return 123;
    };
    (err as unknown as Record<symbol, unknown>)[Symbol.toPrimitive] = () => {
      toPrimitiveCalls++;
      console.error(`LEAK_STDERR: ${secretUrl}`);
      return 'primitive';
    };

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw err;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: err,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [valueOfCalls, toPrimitiveCalls],
    });
  });

  it('replaces Proxy rejection with throwing get trap without executing trap', async () => {
    let getTrapCalls = 0;
    const target = new Error('Base proxy error');
    const proxy = new Proxy(target, {
      get(_t, _prop, _receiver) {
        getTrapCalls++;
        throw new Error(`Trap thrown with ${secretUrl}`);
      },
    });

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw proxy;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: proxy,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [getTrapCalls],
    });
  });

  it('replaces Proxy rejection with throwing getOwnPropertyDescriptor trap', async () => {
    let trapCalls = 0;
    const target = new Error('Base proxy error');
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor() {
        trapCalls++;
        throw new Error(`Trap getOwnPropertyDescriptor thrown with ${secretUrl}`);
      },
    });

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw proxy;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: proxy,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [trapCalls],
    });
  });

  it('replaces Proxy rejection with throwing ownKeys trap', async () => {
    let trapCalls = 0;
    const target = new Error('Base proxy error');
    const proxy = new Proxy(target, {
      ownKeys() {
        trapCalls++;
        throw new Error(`Trap ownKeys thrown with ${secretUrl}`);
      },
    });

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw proxy;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: proxy,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [trapCalls],
    });
  });

  it('replaces combination of cyclic references and hostile hooks without calling hook', async () => {
    let getterCalls = 0;
    const nodeA: Record<string, unknown> = { name: 'A' };
    const nodeB: Record<string, unknown> = { name: 'B' };
    nodeA['next'] = nodeB;
    nodeB['next'] = nodeA;

    Object.defineProperty(nodeB, 'hostileGetter', {
      get() {
        getterCalls++;
        return secretUrl;
      },
      enumerable: true,
      configurable: true,
    });

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw nodeA;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: nodeA,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [getterCalls],
    });
  });

  it('reviewer child-process regression: custom inspection hook never executes and no sentinel reaches stdout or stderr', async () => {
    const childScript = `
      import { createDatabase, DatabaseError } from './packages/infrastructure/src/database/index.ts';
      const dummyConfig = {
        databaseUrl: 'postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev',
        poolMax: 2,
        connectionTimeoutMs: 1000,
        idleTimeoutMs: 1000,
        statementTimeoutMs: 1000,
        sslMode: 'disable',
      };
      const mockPool = {
        on: () => {},
        connect: async () => ({
          query: async () => ({ rows: [], rowCount: 0, command: 'SELECT' }),
          release: () => {},
          on: () => {},
          removeListener: () => {},
        }),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });
      let hookCalls = 0;
      const err = new Error('Safe error message');
      err[Symbol.for('nodejs.util.inspect.custom')] = () => {
        hookCalls++;
        console.error('${secretUrl}');
        return 'safe-looking string';
      };
      try {
        await db.withTransaction(async () => {
          throw err;
        });
      } catch (caught) {
        if (caught instanceof DatabaseError && hookCalls === 0) {
          process.exit(0);
        }
        process.exit(2);
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
    const combinedOutput = stdout + stderr;
    for (const sentinel of sentinels) {
      expect(combinedOutput).not.toContain(sentinel);
    }
  });

  it('Case A: replaces rejection of ordinary object with Proxy in prototype chain without invoking any traps', async () => {
    let ownKeysCalls = 0;
    let getProtoCalls = 0;
    let getDescCalls = 0;
    let getCalls = 0;
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          ownKeysCalls++;
          throw new Error(`Trap ownKeys with ${secretUrl}`);
        },
        getPrototypeOf() {
          getProtoCalls++;
          throw new Error(`Trap getPrototypeOf with ${secretUrl}`);
        },
        getOwnPropertyDescriptor() {
          getDescCalls++;
          throw new Error(`Trap getOwnPropertyDescriptor with ${secretUrl}`);
        },
        get() {
          getCalls++;
          throw new Error(`Trap get with ${secretUrl}`);
        },
      },
    );

    const ordinaryObj = {};
    Object.setPrototypeOf(ordinaryObj, proxy);

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw ordinaryObj;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: ordinaryObj,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [ownKeysCalls, getProtoCalls, getDescCalls, getCalls],
    });
  });

  it('Case A: replaces rejection of ordinary object with multi-level Proxy in prototype chain without invoking any traps', async () => {
    let ownKeysCalls = 0;
    let getProtoCalls = 0;
    let getDescCalls = 0;
    let getCalls = 0;
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          ownKeysCalls++;
          throw new Error(`Trap ownKeys with ${secretUrl}`);
        },
        getPrototypeOf() {
          getProtoCalls++;
          throw new Error(`Trap getPrototypeOf with ${secretUrl}`);
        },
        getOwnPropertyDescriptor() {
          getDescCalls++;
          throw new Error(`Trap getOwnPropertyDescriptor with ${secretUrl}`);
        },
        get() {
          getCalls++;
          throw new Error(`Trap get with ${secretUrl}`);
        },
      },
    );

    const mid = Object.create(proxy);
    const ordinaryObj = Object.create(mid);

    const { mockPool, mockClient, clientQueries } = createMockPool();
    const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });

    let caught: unknown;
    try {
      await db.withTransaction(async () => {
        throw ordinaryObj;
      });
    } catch (e) {
      caught = e;
    }

    assertSafeRejectionResult({
      caughtErr: caught,
      originalErr: ordinaryObj,
      sentinels,
      clientQueries,
      mockClient,
      hookCounters: [ownKeysCalls, getProtoCalls, getDescCalls, getCalls],
    });
  });

  it('Case A child-process regression: ordinary object with Proxy prototype never triggers traps and no credential reaches stdout or stderr', async () => {
    const childScript = `
      import { createDatabase, DatabaseError } from './packages/infrastructure/src/database/index.ts';
      const dummyConfig = {
        databaseUrl: 'postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev',
        poolMax: 2,
        connectionTimeoutMs: 1000,
        idleTimeoutMs: 1000,
        statementTimeoutMs: 1000,
        sslMode: 'disable',
      };
      const mockPool = {
        on: () => {},
        connect: async () => ({
          query: async () => ({ rows: [], rowCount: 0, command: 'SELECT' }),
          release: () => {},
          on: () => {},
          removeListener: () => {},
        }),
      };
      const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });
      let trapCalls = 0;
      const proxy = new Proxy({}, {
        ownKeys() { trapCalls++; console.error('${secretUrl}'); throw new Error('TRAP_OWNKEYS'); },
        getPrototypeOf() { trapCalls++; console.error('${secretUrl}'); throw new Error('TRAP_GETPROTO'); },
        getOwnPropertyDescriptor() { trapCalls++; console.error('${secretUrl}'); throw new Error('TRAP_DESC'); },
        get() { trapCalls++; console.error('${secretUrl}'); throw new Error('TRAP_GET'); },
      });
      const ordinaryObj = {};
      Object.setPrototypeOf(ordinaryObj, proxy);
      try {
        await db.withTransaction(async () => {
          throw ordinaryObj;
        });
      } catch (caught) {
        if (caught instanceof DatabaseError && trapCalls === 0) {
          process.exit(0);
        }
        process.exit(2);
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
    const combinedOutput = stdout + stderr;
    for (const sentinel of sentinels) {
      expect(combinedOutput).not.toContain(sentinel);
    }
  });
});
