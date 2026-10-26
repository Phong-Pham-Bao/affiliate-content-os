import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, DatabaseError, type Database } from '../../src/database/index.js';
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

  describe('falsy transaction rejection and rollback visibility in real PostgreSQL', () => {
    const falsyCases = [
      { name: 'undefined', value: undefined },
      { name: 'false', value: false },
      { name: '0', value: 0 },
      { name: "''", value: '' },
    ];

    it('proves a statement error caught inside a callback cannot report transaction success, performs no commit, and persists no writes', async () => {
      const uniqueItemName = `swallowed_statement_err_${Date.now()}`;

      let caughtInsideCallback: unknown;
      const txPromise = db.withTransaction(async (tx) => {
        // 1. Initial write
        await tx.query('INSERT INTO test_items (name, value) VALUES ($1, $2);', [
          uniqueItemName,
          'tentative_write_before_statement_error',
        ]);

        // 2. Trigger a real statement error (selecting from non-existent table in PostgreSQL)
        try {
          await tx.query('SELECT * FROM non_existent_table_for_remediation_03;');
        } catch (err) {
          caughtInsideCallback = err;
          // Swallowing the error and returning normally!
        }

        return { fakeSuccess: true, data: 999 };
      });

      // withTransaction must reject with the safe DatabaseError, NOT resolve with { fakeSuccess: true }
      let txErr: unknown;
      try {
        await txPromise;
      } catch (err) {
        txErr = err;
      }
      expect(txErr).toBeInstanceOf(DatabaseError);
      expect(caughtInsideCallback).toBeInstanceOf(DatabaseError);

      // Verify PostgreSQL did not commit the write and rolled back
      const check = await db.query('SELECT id FROM test_items WHERE name = $1;', [uniqueItemName]);
      expect(check.rowCount).toBe(0);

      // Verify subsequent query can acquire and use the released connection from pool
      const probeQuery = await db.query<{ one: number }>('SELECT 1 as one;');
      expect(probeQuery.rowCount).toBe(1);
    });

    for (const { name, value } of falsyCases) {
      it(`preserves falsy rejection ${name}, rolls back changes, and allows client reuse`, async () => {
        const uniqueName = `falsy_tx_real_${name}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        let caught: unknown;
        let didReject = false;
        try {
          await db.withTransaction(async (tx) => {
            await tx.query('INSERT INTO test_items (name, value) VALUES ($1, $2);', [
              uniqueName,
              'falsy_rollback_data',
            ]);
            return Promise.reject(value);
          });
        } catch (err) {
          didReject = true;
          caught = err;
        }

        expect(didReject).toBe(true);
        expect(caught).toBe(value);

        // Verify rollback: row was not persisted
        const check = await db.query('SELECT id FROM test_items WHERE name = $1;', [uniqueName]);
        expect(check.rowCount).toBe(0);

        // Verify subsequent query can acquire and use the released connection from pool
        const probeQuery = await db.query<{ one: number }>('SELECT 1 as one;');
        expect(probeQuery.rowCount).toBe(1);
        expect(probeQuery.rows[0]?.one).toBe(1);
      });
    }
  });

  it('fails closed when NODE_ENV is absent in child process without creating test database', async () => {
    const { spawnSync } = await import('node:child_process');
    const childScript = `
      import { setupIsolatedTestDatabase } from './packages/infrastructure/test/integration/helpers/setup.js';
      try {
        await setupIsolatedTestDatabase();
        process.exit(0);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    `;

    const childEnv = { ...process.env };
    delete childEnv['NODE_ENV'];
    childEnv['TEST_DATABASE_ADMIN_URL'] = context.adminConfig.testDatabaseAdminUrl;
    childEnv['TEST_DATABASE_DISPOSABLE'] = 'YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED';
    childEnv['DATABASE_SSL_MODE'] = 'disable';

    const result = spawnSync(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', '--input-type=module', '-e', childScript],
      {
        cwd: process.cwd(),
        env: childEnv,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('invalid or missing NODE_ENV');
    expect(result.stderr).not.toContain('YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED');
    expect(result.stderr).not.toContain('secret_password');
  });
});
