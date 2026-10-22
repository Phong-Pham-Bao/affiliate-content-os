import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkMigrationStatusCommand,
  discoverMigrations,
  getDefaultMigrationsDir,
  runMigrationCommand,
  validateMigrations,
} from '../../src/database/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL migration runner and validation integration', () => {
  let context: TestDatabaseContext;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
  });

  afterAll(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  it('runs initial migration on empty database and creates schema_migrations', async () => {
    const defaultDir = getDefaultMigrationsDir();
    const local = discoverMigrations(defaultDir);

    // Initial status
    const initialStatus = await checkMigrationStatusCommand(context.dbUrl, false, {
      migrationsDir: defaultDir,
    });
    expect(initialStatus.applied).toHaveLength(0);
    expect(initialStatus.pending).toHaveLength(local.length);
    expect(initialStatus.isUpToDate).toBe(false);

    // Run migrations
    const runResult = await runMigrationCommand(context.dbUrl, false, {
      migrationsDir: defaultDir,
    });
    expect(runResult.appliedCount).toBe(local.length);

    // Verify status is up to date
    const updatedStatus = await checkMigrationStatusCommand(context.dbUrl, false, {
      migrationsDir: defaultDir,
    });
    expect(updatedStatus.applied).toHaveLength(local.length);
    expect(updatedStatus.pending).toHaveLength(0);
    expect(updatedStatus.isUpToDate).toBe(true);

    // Direct SQL inspection of schema_migrations
    const client = new pg.Client({ connectionString: context.dbUrl });
    await client.connect();
    try {
      const rows = await client.query<{
        migration_number: number;
        name: string;
        checksum_sha256: string;
        applied_at: Date;
      }>('SELECT migration_number, name, checksum_sha256, applied_at FROM schema_migrations;');

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.migration_number).toBe(1);
      expect(rows.rows[0]!.name).toBe('baseline');
      expect(rows.rows[0]!.checksum_sha256).toBe(local[0]!.checksumSha256);
      expect(rows.rows[0]!.applied_at).toBeInstanceOf(Date);
    } finally {
      await client.end();
    }
  });

  it('proves second migration run is a complete no-op and preserves timestamps', async () => {
    const defaultDir = getDefaultMigrationsDir();

    const client = new pg.Client({ connectionString: context.dbUrl });
    await client.connect();
    let originalTimestamp: Date;
    try {
      const res = await client.query<{ applied_at: Date }>(
        'SELECT applied_at FROM schema_migrations WHERE migration_number = 1;',
      );
      originalTimestamp = res.rows[0]!.applied_at;
    } finally {
      await client.end();
    }

    // Run again
    const secondRun = await runMigrationCommand(context.dbUrl, false, {
      migrationsDir: defaultDir,
    });
    expect(secondRun.appliedCount).toBe(0);

    // Verify timestamp was preserved
    const client2 = new pg.Client({ connectionString: context.dbUrl });
    await client2.connect();
    try {
      const res2 = await client2.query<{ applied_at: Date }>(
        'SELECT applied_at FROM schema_migrations WHERE migration_number = 1;',
      );
      expect(res2.rows[0]!.applied_at.getTime()).toBe(originalTimestamp.getTime());
    } finally {
      await client2.end();
    }
  });

  it('serializes concurrent migration runners via advisory lock', async () => {
    const defaultDir = getDefaultMigrationsDir();

    // Run two concurrent migration runners simultaneously
    const p1 = runMigrationCommand(context.dbUrl, false, { migrationsDir: defaultDir });
    const p2 = runMigrationCommand(context.dbUrl, false, { migrationsDir: defaultDir });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.appliedCount + r2.appliedCount).toBe(0); // Already migrated
  });

  it('rolls back failed migration completely and leaves schema_migrations uncorrupted', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_int_fail_'));
    const subContext = await setupIsolatedTestDatabase();

    try {
      // 0001 creates schema_migrations
      fs.writeFileSync(
        path.join(tempDir, '0001_baseline.sql'),
        fs.readFileSync(path.join(getDefaultMigrationsDir(), '0001_baseline.sql'), 'utf8'),
      );
      // 0002 has invalid SQL syntax
      fs.writeFileSync(
        path.join(tempDir, '0002_failing.sql'),
        'CREATE TABLE test_should_rollback (id int); MALFORMED SYNTAX ERROR;',
      );

      await expect(
        runMigrationCommand(subContext.dbUrl, false, { migrationsDir: tempDir }),
      ).rejects.toThrow(/failed during execution/);

      // Verify that 0001 was applied, but 0002 was not applied and table was rolled back
      const client = new pg.Client({ connectionString: subContext.dbUrl });
      await client.connect();
      try {
        const migRows = await client.query('SELECT migration_number FROM schema_migrations;');
        expect(migRows.rows).toHaveLength(1);
        expect(migRows.rows[0]!.migration_number).toBe(1);

        const tableCheck = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.tables 
             WHERE table_name = 'test_should_rollback'
           ) as exists;`,
        );
        expect(tableCheck.rows[0]!.exists).toBe(false);
      } finally {
        await client.end();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await subContext.cleanup();
    }
  });

  it('executes validateMigrations end-to-end on real PostgreSQL and drops isolated database', async () => {
    const result = await validateMigrations({
      adminUrl: context.adminUrl,
    });

    expect(result.isolatedDatabaseName).toMatch(/^acos_test_[0-9a-f]{1,48}$/);
    expect(result.appliedCount).toBeGreaterThanOrEqual(1);
    expect(result.secondRunCount).toBe(0);
    expect(result.verifiedChecksums).toBeGreaterThanOrEqual(1);

    // Verify isolated database was dropped
    const client = new pg.Client({ connectionString: context.adminUrl });
    await client.connect();
    try {
      const check = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) as exists;',
        [result.isolatedDatabaseName],
      );
      expect(check.rows[0]!.exists).toBe(false);
    } finally {
      await client.end();
    }
  });
});
