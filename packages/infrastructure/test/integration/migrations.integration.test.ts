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
} from '../../src/database/index.js';
import { validateMigrations } from '../../src/database/migrations/validate.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('Real PostgreSQL migration runner and validation integration', () => {
  let context: TestDatabaseContext;

  beforeAll(async () => {
    context = await setupIsolatedTestDatabase({ skipMigrations: true });
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

  it('serializes concurrent migration runners via advisory lock on empty database', async () => {
    const emptyContext = await setupIsolatedTestDatabase({ skipMigrations: true });
    try {
      const defaultDir = getDefaultMigrationsDir();

      // Run two concurrent migration runners simultaneously against an empty database
      const p1 = runMigrationCommand(emptyContext.dbUrl, false, { migrationsDir: defaultDir });
      const p2 = runMigrationCommand(emptyContext.dbUrl, false, { migrationsDir: defaultDir });

      const [r1, r2] = await Promise.all([p1, p2]);
      // One runner applies migration 0001, the second acquires the lock after and finds 0 pending
      expect(r1.appliedCount + r2.appliedCount).toBe(1);
      expect([0, 1]).toContain(r1.appliedCount);
      expect([0, 1]).toContain(r2.appliedCount);

      // Verify direct database state: exactly 1 migration recorded
      const client = new pg.Client({ connectionString: emptyContext.dbUrl });
      await client.connect();
      try {
        const rows = await client.query('SELECT migration_number FROM schema_migrations;');
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]?.migration_number).toBe(1);
      } finally {
        await client.end();
      }
    } finally {
      await emptyContext.cleanup();
    }
  });

  it('times out when advisory lock cannot be acquired within lockTimeoutMs', async () => {
    const lockContext = await setupIsolatedTestDatabase({ skipMigrations: true });
    const lockClient = new pg.Client({ connectionString: lockContext.dbUrl });
    await lockClient.connect();

    try {
      // Hold advisory lock on lockClient
      await lockClient.query('SELECT pg_advisory_lock($1::bigint);', ['847291837492817263']);

      // Attempt migration with short lock timeout
      await expect(
        runMigrationCommand(lockContext.dbUrl, false, {
          lockTimeoutMs: 200,
        }),
      ).rejects.toThrow(/Migration lock acquisition timed out after 200ms/);
    } finally {
      try {
        await lockClient.query('SELECT pg_advisory_unlock($1::bigint);', ['847291837492817263']);
      } catch {
        // ignore
      }
      await lockClient.end();
      await lockContext.cleanup();
    }
  });

  it('rolls back failed migration completely, leaves schema_migrations uncorrupted, and recovers on fix', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos_int_fail_'));
    const subContext = await setupIsolatedTestDatabase({ skipMigrations: true });

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

      // Recover by fixing 0002 SQL
      fs.writeFileSync(
        path.join(tempDir, '0002_failing.sql'),
        'CREATE TABLE test_recovered (id int);',
      );

      const recoveryRun = await runMigrationCommand(subContext.dbUrl, false, {
        migrationsDir: tempDir,
      });
      expect(recoveryRun.appliedCount).toBe(1);

      // Verify schema_migrations now has 2 rows and recovered table exists
      const client2 = new pg.Client({ connectionString: subContext.dbUrl });
      await client2.connect();
      try {
        const migRows = await client2.query<{ migration_number: number }>(
          'SELECT migration_number FROM schema_migrations ORDER BY migration_number ASC;',
        );
        expect(migRows.rows).toHaveLength(2);
        expect(migRows.rows[1]!.migration_number).toBe(2);

        const tableCheck = await client2.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_name = 'test_recovered'
           ) as exists;`,
        );
        expect(tableCheck.rows[0]!.exists).toBe(true);
      } finally {
        await client2.end();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await subContext.cleanup();
    }
  });

  it('detects applied migration numbering gap or order corruption', async () => {
    const gapContext = await setupIsolatedTestDatabase();
    const client = new pg.Client({ connectionString: gapContext.dbUrl });
    await client.connect();
    try {
      // Intentionally insert a row with migration_number = 3 (gap: missing 2)
      await client.query(
        `INSERT INTO schema_migrations (migration_number, name, checksum_sha256, applied_at)
         VALUES (3, 'gap_migration', 'dummy_checksum', NOW());`,
      );

      await expect(checkMigrationStatusCommand(gapContext.dbUrl, false)).rejects.toThrow(
        /Database migration numbering gap or order corruption detected/,
      );
    } finally {
      await client.end();
      await gapContext.cleanup();
    }
  });

  it('detects checksum drift and name mismatch drift', async () => {
    const driftContext = await setupIsolatedTestDatabase();
    const client = new pg.Client({ connectionString: driftContext.dbUrl });
    await client.connect();
    try {
      // 1. Checksum mismatch drift
      await client.query(
        `UPDATE schema_migrations SET checksum_sha256 = 'altered_checksum_123456789' WHERE migration_number = 1;`,
      );

      await expect(checkMigrationStatusCommand(driftContext.dbUrl, false)).rejects.toThrow(
        /Drift detected: checksum mismatch for migration 0001/,
      );

      // 2. Name mismatch drift
      const baselineChecksum = discoverMigrations(getDefaultMigrationsDir())[0]!.checksumSha256;
      await client.query(
        `UPDATE schema_migrations SET checksum_sha256 = $1, name = 'corrupted_name' WHERE migration_number = 1;`,
        [baselineChecksum],
      );

      await expect(checkMigrationStatusCommand(driftContext.dbUrl, false)).rejects.toThrow(
        /Drift detected: name mismatch for migration 0001/,
      );
    } finally {
      await client.end();
      await driftContext.cleanup();
    }
  });

  it('executes validateMigrations end-to-end on real PostgreSQL and drops isolated database', async () => {
    const result = await validateMigrations({
      adminConfig: context.adminConfig,
      effectiveNodeEnv: 'test',
      isCi: process.env['CI'] === 'true' || process.env['CI'] === '1',
    });

    expect(result.isolatedDatabaseName).toMatch(/^acos_test_[0-9a-f]{1,48}$/);
    expect(result.appliedCount).toBeGreaterThanOrEqual(1);
    expect(result.secondRunCount).toBe(0);
    expect(result.verifiedChecksums).toBeGreaterThanOrEqual(1);

    // Verify isolated database was dropped
    const client = new pg.Client({
      connectionString: context.adminConfig.testDatabaseAdminUrl,
    });
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
