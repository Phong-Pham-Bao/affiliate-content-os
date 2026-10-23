import { EventEmitter } from 'node:events';
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
});
