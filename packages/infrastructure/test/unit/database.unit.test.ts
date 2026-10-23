import { EventEmitter } from 'node:events';
import util from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  createDatabase,
  DatabaseError,
  stripCredentials,
  type TransactionExecutor,
} from '../../src/database/index.js';

describe('Database client and transaction manager (unit tests with fakes)', () => {
  const dummyConfig = {
    databaseUrl: 'postgresql://fake_user:fake_password@127.0.0.1:5432/fake_db',
    poolMax: 10,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 30000,
    statementTimeoutMs: 15000,
    sslMode: 'disable' as const,
  };

  function createMockPool() {
    const executedQueries: { text: string; params?: readonly unknown[] | undefined }[] = [];
    const clientQueries: { text: string; params?: readonly unknown[] | undefined }[] = [];
    let releaseCalled = false;
    let releasedWithDestroy: boolean | undefined;
    let poolEnded = false;
    const clientEmitter = new EventEmitter();
    let streamDestroyed = false;

    const mockClient = Object.assign(clientEmitter, {
      connection: {
        stream: {
          destroy: vi.fn(() => {
            streamDestroyed = true;
          }),
        },
      },
      query: vi.fn(async (text: string, params?: unknown[]) => {
        clientQueries.push({ text, params });
        return { rows: [{ result: 1 }], rowCount: 1, command: 'SELECT' };
      }),
      release: vi.fn((destroy?: boolean) => {
        releaseCalled = true;
        releasedWithDestroy = destroy;
      }),
    });

    const mockPool = {
      on: vi.fn(),
      query: vi.fn(async (text: string, params?: unknown[]) => {
        executedQueries.push({ text, params });
        return { rows: [{ result: 1 }], rowCount: 1, command: 'SELECT' };
      }),
      connect: vi.fn(async () => mockClient),
      end: vi.fn(async () => {
        poolEnded = true;
      }),
    };

    return {
      mockPool: mockPool as unknown as pg.Pool,
      mockClient,
      executedQueries,
      clientQueries,
      getReleaseCalled: () => releaseCalled,
      getReleasedWithDestroy: () => releasedWithDestroy,
      getPoolEnded: () => poolEnded,
      getStreamDestroyed: () => streamDestroyed,
    };
  }

  it('constructs database lazily without connecting at import or construction', () => {
    const { mockPool } = createMockPool();
    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    expect(db).toBeDefined();
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('probes database connection via SELECT 1 query on dedicated connection', async () => {
    const { mockPool, mockClient, getReleaseCalled } = createMockPool();
    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    await db.probe();

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith('SELECT 1');
    expect(getReleaseCalled()).toBe(true);
  });

  it('aborts probe and destroys client connection when signal fires', async () => {
    const { mockPool, mockClient, getStreamDestroyed } = createMockPool();
    const controller = new AbortController();

    mockClient.query = vi.fn(async () => {
      controller.abort();
      return new Promise<never>(() => {});
    });

    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    await expect(db.probe(controller.signal)).rejects.toThrow(/Database connection probe aborted/);
    expect(getStreamDestroyed()).toBe(true);
  });

  it('executes parameterized queries successfully through pool', async () => {
    const { mockPool, executedQueries } = createMockPool();
    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    const result = await db.query('SELECT $1::int as n', [42]);

    expect(result.rowCount).toBe(1);
    expect(executedQueries).toHaveLength(1);
    expect(executedQueries[0]?.text).toBe('SELECT $1::int as n');
    expect(executedQueries[0]?.params).toEqual([42]);
  });

  it('executes transaction with BEGIN and COMMIT on success and releases client', async () => {
    const { mockPool, clientQueries, getReleaseCalled } = createMockPool();
    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    const result = await db.withTransaction(async (tx) => {
      await tx.query('INSERT INTO items VALUES ($1)', ['test']);
      return 'success_val';
    });

    expect(result).toBe('success_val');
    expect(clientQueries.map((q) => q.text)).toEqual([
      'BEGIN',
      'INSERT INTO items VALUES ($1)',
      'COMMIT',
    ]);
    expect(getReleaseCalled()).toBe(true);
  });

  it('prevents executor escape by invalidating query after transaction completes', async () => {
    const { mockPool } = createMockPool();
    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    let escapedTx: TransactionExecutor | undefined;
    await db.withTransaction(async (tx) => {
      escapedTx = tx;
      await tx.query('SELECT 1');
    });

    expect(escapedTx).toBeDefined();
    await expect(escapedTx!.query('SELECT 2')).rejects.toThrow(
      /Cannot execute query: transaction has already completed/,
    );
  });

  it('rolls back transaction on callback failure and releases client', async () => {
    const { mockPool, clientQueries, getReleaseCalled } = createMockPool();
    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    await expect(
      db.withTransaction(async (tx) => {
        await tx.query('SELECT 1');
        throw new Error('Callback business logic failure');
      }),
    ).rejects.toThrow('Callback business logic failure');

    expect(clientQueries.map((q) => q.text)).toEqual(['BEGIN', 'SELECT 1', 'ROLLBACK']);
    expect(getReleaseCalled()).toBe(true);
  });

  it('preserves original error if rollback fails and always releases client', async () => {
    const { mockPool, mockClient, getReleaseCalled } = createMockPool();
    mockClient.query = vi.fn(async (text: string) => {
      if (text === 'ROLLBACK') {
        throw new Error('Network failure during rollback');
      }
      return { rows: [], rowCount: 0, command: text };
    });

    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    await expect(
      db.withTransaction(async () => {
        throw new Error('Primary error');
      }),
    ).rejects.toThrow('Primary error');

    expect(getReleaseCalled()).toBe(true);
  });

  it('preserves primary transaction error even when client release fails', async () => {
    const { mockPool, mockClient, getReleaseCalled } = createMockPool();
    mockClient.release = vi.fn(() => {
      throw new Error('Release socket failure');
    });

    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    await expect(
      db.withTransaction(async () => {
        throw new Error('Primary callback error');
      }),
    ).rejects.toThrow('Primary callback error');

    expect(getReleaseCalled()).toBe(false); // mockClient.release threw
  });

  it('throws sanitized release error when callback succeeds but release fails', async () => {
    const { mockPool, mockClient } = createMockPool();
    mockClient.release = vi.fn(() => {
      throw new Error('Release socket failure');
    });

    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    await expect(
      db.withTransaction(async () => {
        return 'ok';
      }),
    ).rejects.toThrow(/Failed to release database connection/);
  });

  it('handles checked-out client error during transaction and destroys client', async () => {
    const { mockPool, mockClient, getReleasedWithDestroy } = createMockPool();
    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    await expect(
      db.withTransaction(async () => {
        mockClient.emit('error', new Error('Client connection reset by peer'));
      }),
    ).rejects.toThrow(/Connection reset by peer/);

    expect(getReleasedWithDestroy()).toBe(true);
  });

  it('handles close idempotently and rejects subsequent queries', async () => {
    const { mockPool, getPoolEnded } = createMockPool();
    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    expect(db.isClosing()).toBe(false);

    const closePromise1 = db.close();
    const closePromise2 = db.close();
    expect(closePromise1).toBe(closePromise2);

    await closePromise1;
    expect(getPoolEnded()).toBe(true);
    expect(db.isClosing()).toBe(true);

    await expect(db.query('SELECT 1')).rejects.toThrow(DatabaseError);
    await expect(db.withTransaction(async () => {})).rejects.toThrow(DatabaseError);
    await expect(db.probe()).rejects.toThrow(DatabaseError);

    // Repeated call after close resolves immediately
    await expect(db.close()).resolves.toBeUndefined();
  });

  it('destroys and releases late-acquired probe client if connection resolves after abort signal fired', async () => {
    let resolveConnect!: (client: unknown) => void;
    const pendingConnect = new Promise<unknown>((resolve) => {
      resolveConnect = resolve;
    });

    const { mockClient, getStreamDestroyed, getReleasedWithDestroy } = createMockPool();
    const mockPool = {
      on: vi.fn(),
      query: vi.fn(),
      connect: vi.fn(() => pendingConnect),
      end: vi.fn(async () => {}),
    };

    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool as unknown as pg.Pool,
    });

    const controller = new AbortController();
    const probePromise = db.probe(controller.signal);

    // Abort while connect is pending
    controller.abort();
    await expect(probePromise).rejects.toThrow('Database connection probe aborted');

    // Connect resolves late in the background
    resolveConnect(mockClient);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getStreamDestroyed()).toBe(true);
    expect(getReleasedWithDestroy()).toBe(true);
  });

  it('destroys client and throws sanitized error when checked-out client emits error during probe query', async () => {
    const { mockPool, mockClient, getReleasedWithDestroy } = createMockPool();
    mockClient.query = vi.fn(async () => {
      mockClient.emit('error', new Error('Connection reset by peer'));
      throw new Error('Socket closed');
    });

    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    await expect(db.probe()).rejects.toThrow(
      /Connection reset by peer|Database connection probe failed/,
    );
    expect(getReleasedWithDestroy()).toBe(true);
  });

  it('invalidates transaction executor immediately upon callback return before COMMIT completes', async () => {
    const { mockPool, mockClient } = createMockPool();
    let executorRef!: TransactionExecutor;
    let resolveCommit!: () => void;
    let commitStarted!: () => void;
    const commitPromise = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    const commitStartedPromise = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });

    mockClient.query = vi.fn(async (text: string) => {
      if (text === 'COMMIT') {
        commitStarted();
        await commitPromise;
      }
      return { rows: [], rowCount: 0, command: 'SELECT' };
    });

    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool,
    });

    const txPromise = db.withTransaction(async (tx) => {
      executorRef = tx;
      return 'done';
    });

    await commitStartedPromise;

    // At this point, the callback returned and COMMIT is pending.
    // Querying through the executor MUST fail immediately:
    await expect(executorRef.query('SELECT 1')).rejects.toThrow(
      'Cannot execute query: transaction has already completed',
    );

    resolveCommit();
    await expect(txPromise).resolves.toBe('done');
  });

  it('preserves the exact first close promise and rejection across repeated close calls', async () => {
    const closeError = new Error('Pool shutdown error');
    const mockPool = {
      on: vi.fn(),
      query: vi.fn(),
      connect: vi.fn(),
      end: vi.fn().mockRejectedValue(closeError),
    };

    const db = createDatabase(dummyConfig, {
      poolFactory: () => mockPool as unknown as pg.Pool,
    });

    const closePromise1 = db.close();
    const closePromise2 = db.close();

    expect(closePromise1).toBe(closePromise2);

    await expect(closePromise1).rejects.toThrow(/Database pool shutdown failed/);
    await expect(closePromise2).rejects.toThrow(/Database pool shutdown failed/);

    // Third call after failure still returns the exact same rejected promise
    const closePromise3 = db.close();
    expect(closePromise3).toBe(closePromise1);
    await expect(closePromise3).rejects.toThrow(/Database pool shutdown failed/);
  });

  it('sanitizes connection string and credentials in error formatting without disclosing origin or database', () => {
    const raw = 'Connection failed to postgresql://admin:super_secret_password@10.0.0.1:5432/my_db';
    const sanitized = stripCredentials(raw);
    expect(sanitized).not.toContain('super_secret_password');
    expect(sanitized).not.toContain('10.0.0.1');
    expect(sanitized).not.toContain('5432');
    expect(sanitized).not.toContain('my_db');
    expect(sanitized).toContain('postgresql://[REDACTED]');
  });

  describe('falsy transaction rejection and success handling', () => {
    const falsyValues = [
      { name: 'undefined', value: undefined },
      { name: 'null', value: null },
      { name: 'false', value: false },
      { name: '0', value: 0 },
      { name: 'NaN', value: Number.NaN },
      { name: "''", value: '' },
    ];

    for (const { name, value } of falsyValues) {
      it(`preserves falsy rejection: ${name}`, async () => {
        const { mockPool, mockClient, clientQueries } = createMockPool();
        const db = createDatabase(dummyConfig, {
          poolFactory: () => mockPool,
        });

        let caughtError: unknown;
        let rejected = false;
        try {
          await db.withTransaction(async () => {
            return Promise.reject(value);
          });
        } catch (err) {
          rejected = true;
          caughtError = err;
        }

        expect(rejected).toBe(true);
        if (Number.isNaN(value)) {
          expect(Number.isNaN(caughtError)).toBe(true);
        } else {
          expect(caughtError).toBe(value);
        }

        const queryTexts = clientQueries.map((q) => q.text);
        expect(queryTexts).toContain('BEGIN');
        expect(queryTexts).toContain('ROLLBACK');
        expect(queryTexts).not.toContain('COMMIT');
        expect(mockClient.release).toHaveBeenCalledTimes(1);
      });

      it(`preserves falsy resolved value: ${name}`, async () => {
        const { mockPool, mockClient, clientQueries } = createMockPool();
        const db = createDatabase(dummyConfig, {
          poolFactory: () => mockPool,
        });

        const result = await db.withTransaction(async () => {
          return value;
        });

        if (Number.isNaN(value)) {
          expect(Number.isNaN(result)).toBe(true);
        } else {
          expect(result).toBe(value);
        }

        const queryTexts = clientQueries.map((q) => q.text);
        expect(queryTexts).toContain('BEGIN');
        expect(queryTexts).toContain('COMMIT');
        expect(queryTexts).not.toContain('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalledTimes(1);
      });
    }

    it('preserves falsy rejection when rollback fails, release fails, or both fail', async () => {
      for (const { value } of falsyValues) {
        // 1. Rollback fails
        {
          const { mockPool, mockClient } = createMockPool();
          mockClient.query = vi.fn(async (text: string) => {
            if (text === 'ROLLBACK') {
              throw new Error('Rollback network fault');
            }
            return { rows: [], rowCount: 0, command: 'SELECT' };
          });

          const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });
          let caught: unknown;
          try {
            await db.withTransaction(async () => Promise.reject(value));
          } catch (err) {
            caught = err;
          }
          if (Number.isNaN(value)) {
            expect(Number.isNaN(caught)).toBe(true);
          } else {
            expect(caught).toBe(value);
          }
          expect(mockClient.release).toHaveBeenCalledTimes(1);
        }

        // 2. Release fails
        {
          const { mockPool, mockClient } = createMockPool();
          mockClient.release = vi.fn(() => {
            throw new Error('Release socket fault');
          });

          const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });
          let caught: unknown;
          try {
            await db.withTransaction(async () => Promise.reject(value));
          } catch (err) {
            caught = err;
          }
          if (Number.isNaN(value)) {
            expect(Number.isNaN(caught)).toBe(true);
          } else {
            expect(caught).toBe(value);
          }
          expect(mockClient.release).toHaveBeenCalledTimes(1);
        }

        // 3. Both rollback and release fail
        {
          const { mockPool, mockClient } = createMockPool();
          mockClient.query = vi.fn(async (text: string) => {
            if (text === 'ROLLBACK') {
              throw new Error('Rollback fault');
            }
            return { rows: [], rowCount: 0, command: 'SELECT' };
          });
          mockClient.release = vi.fn(() => {
            throw new Error('Release fault');
          });

          const db = createDatabase(dummyConfig, { poolFactory: () => mockPool });
          let caught: unknown;
          try {
            await db.withTransaction(async () => Promise.reject(value));
          } catch (err) {
            caught = err;
          }
          if (Number.isNaN(value)) {
            expect(Number.isNaN(caught)).toBe(true);
          } else {
            expect(caught).toBe(value);
          }
          expect(mockClient.release).toHaveBeenCalledTimes(1);
        }
      }
    });

    it('sanitizes credentials in callback Error message and manually assigned stack', async () => {
      const sentinels = [
        'sensitive_tx_user',
        'super_secret_tx_password',
        '10.20.30.40',
        'secret_tenant_db',
        'sensitive_query_param=supersecret',
        'sensitive_hash_frag',
      ];
      const sensitiveUrl =
        'postgresql://sensitive_tx_user:super_secret_tx_password@10.20.30.40:5432/secret_tenant_db?sensitive_query_param=supersecret#sensitive_hash_frag';

      const { mockPool } = createMockPool();
      const db = createDatabase(dummyConfig, {
        poolFactory: () => mockPool,
      });

      const customErr = new Error(`Transaction callback failed with connection to ${sensitiveUrl}`);
      customErr.stack = `Error: Transaction callback failed with connection to ${sensitiveUrl}\n    at customStackTracer (/app/src/service.ts:42:15)`;

      let caughtErr: unknown;
      try {
        await db.withTransaction(async () => {
          throw customErr;
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBe(customErr);
      const castErr = caughtErr as Error;

      const message = castErr.message;
      const stack = castErr.stack ?? '';
      const stringified = String(castErr);
      const inspected = util.inspect(castErr);
      const json = JSON.stringify(castErr);

      for (const sentinel of sentinels) {
        expect(message).not.toContain(sentinel);
        expect(stack).not.toContain(sentinel);
        expect(stringified).not.toContain(sentinel);
        expect(inspected).not.toContain(sentinel);
        if (json) {
          expect(json).not.toContain(sentinel);
        }
      }

      expect(message).toContain('postgresql://[REDACTED]');
      expect(stack).toContain('postgresql://[REDACTED]');
    });

    it('sanitizes IPv6 database credentials in callback Error message and stack', async () => {
      const sentinels = ['ipv6_user', 'ipv6_pass', '2001:db8::1', 'ipv6_db'];
      const sensitiveIpv6Url = 'postgresql://ipv6_user:ipv6_pass@[2001:db8::1]:5432/ipv6_db';

      const { mockPool } = createMockPool();
      const db = createDatabase(dummyConfig, {
        poolFactory: () => mockPool,
      });

      const errWithIpv6 = new Error(`Failed to query ${sensitiveIpv6Url}`);
      errWithIpv6.stack = `Error: Failed to query ${sensitiveIpv6Url}\n    at query (/app/src/repo.ts:10:5)`;

      let caught: unknown;
      try {
        await db.withTransaction(async () => {
          throw errWithIpv6;
        });
      } catch (e) {
        caught = e;
      }

      const err = caught as Error;
      for (const s of sentinels) {
        expect(err.message).not.toContain(s);
        expect(err.stack).not.toContain(s);
        expect(util.inspect(err)).not.toContain(s);
      }
      expect(err.message).toContain('postgresql://[REDACTED]');
    });
  });
});
