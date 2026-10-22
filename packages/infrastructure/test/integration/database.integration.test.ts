import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/database/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL persistence and transaction integration', () => {
  let context: TestDatabaseContext;
  let db: Database;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    db = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 5,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 5000,
      sslMode: 'disable',
    });
    await db.probe();
    await db.query(
      'CREATE TABLE test_items (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value TEXT);',
    );
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
    if (context) {
      await context.cleanup();
    }
  });

  it('probes real PostgreSQL connection successfully', async () => {
    await expect(db.probe()).resolves.toBeUndefined();
  });

  it('guarantees parameter safety against SQL injection and formatting anomalies', async () => {
    const maliciousPayload =
      '\' OR 1=1; DROP TABLE test_items; -- /* comment */ Unicode \uD83D\uDE00 \u00E9 \u2603 " -- ';

    await db.query('INSERT INTO test_items (name, value) VALUES ($1, $2);', [
      'safe_name',
      maliciousPayload,
    ]);

    const result = await db.query<{ name: string; value: string }>(
      'SELECT name, value FROM test_items WHERE name = $1;',
      ['safe_name'],
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]?.value).toBe(maliciousPayload);

    // Table was not dropped by the SQL injection payload
    const tableCheck = await db.query('SELECT 1 FROM test_items LIMIT 1;');
    expect(tableCheck.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('commits transaction changes visibly across separate connections', async () => {
    const insertedId = await db.withTransaction(async (tx) => {
      const res = await tx.query<{ id: number }>(
        'INSERT INTO test_items (name, value) VALUES ($1, $2) RETURNING id;',
        ['committed_item', 'visible_data'],
      );
      return res.rows[0]!.id;
    });

    // Query on separate connection from pool
    const check = await db.query<{ name: string }>('SELECT name FROM test_items WHERE id = $1;', [
      insertedId,
    ]);
    expect(check.rowCount).toBe(1);
    expect(check.rows[0]?.name).toBe('committed_item');
  });

  it('rolls back transaction changes completely when callback rejects', async () => {
    const uniqueName = `rollback_test_${Date.now()}`;

    await expect(
      db.withTransaction(async (tx) => {
        await tx.query('INSERT INTO test_items (name, value) VALUES ($1, $2);', [
          uniqueName,
          'should_never_persist',
        ]);
        throw new Error('Simulated transaction business failure');
      }),
    ).rejects.toThrow('Simulated transaction business failure');

    const check = await db.query('SELECT id FROM test_items WHERE name = $1;', [uniqueName]);
    expect(check.rowCount).toBe(0);
  });

  it('executes concurrent independent transactions concurrently', async () => {
    const tx1 = db.withTransaction(async (tx) => {
      const res = await tx.query<{ id: number }>(
        'INSERT INTO test_items (name, value) VALUES ($1, $2) RETURNING id;',
        ['concurrent_1', 'val_1'],
      );
      return res.rows[0]!.id;
    });

    const tx2 = db.withTransaction(async (tx) => {
      const res = await tx.query<{ id: number }>(
        'INSERT INTO test_items (name, value) VALUES ($1, $2) RETURNING id;',
        ['concurrent_2', 'val_2'],
      );
      return res.rows[0]!.id;
    });

    const [id1, id2] = await Promise.all([tx1, tx2]);
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it('enforces statement timeout when query duration exceeds limit', async () => {
    const timeoutDb = createDatabase({
      databaseUrl: context.dbUrl,
      poolMax: 2,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 10000,
      statementTimeoutMs: 200, // 200ms statement timeout
      sslMode: 'disable',
    });

    try {
      // pg_sleep for 1 second should trigger 200ms statement timeout
      await expect(timeoutDb.query('SELECT pg_sleep(1);')).rejects.toThrow(
        /canceling statement due to statement timeout|statement timeout/,
      );
    } finally {
      await timeoutDb.close();
    }
  });
});
