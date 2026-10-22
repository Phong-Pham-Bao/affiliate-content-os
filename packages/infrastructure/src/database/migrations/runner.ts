import pg from 'pg';
import { DatabaseError, sanitizeDatabaseError } from '../errors.js';
import { discoverMigrations, getDefaultMigrationsDir } from './discovery.js';
import type {
  AppliedMigration,
  MigrationFile,
  MigrationStatus,
  RunMigrationsOptions,
} from './types.js';

export const MIGRATION_ADVISORY_LOCK_ID = '847291837492817263';
export const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 10000;
export const DEFAULT_MIGRATION_CONNECTION_TIMEOUT_MS = 5000;
export const DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS = 15000;

export async function acquireAdvisoryLock(
  client: pg.ClientBase,
  lockId: string = MIGRATION_ADVISORY_LOCK_ID,
  timeoutMs: number = DEFAULT_MIGRATION_LOCK_TIMEOUT_MS,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const res = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS locked;',
      [lockId],
    );
    if (res.rows[0]?.locked === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new DatabaseError(
    `Migration lock acquisition timed out after ${timeoutMs}ms: lock is held by another process`,
  );
}

export async function releaseAdvisoryLock(
  client: pg.ClientBase,
  lockId: string = MIGRATION_ADVISORY_LOCK_ID,
): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1::bigint);', [lockId]);
  } catch {
    // Unlock failure ignored during cleanup
  }
}

export async function fetchMigrationStatus(
  client: pg.ClientBase,
  localMigrations: readonly MigrationFile[],
): Promise<MigrationStatus> {
  const tableCheck = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'schema_migrations'
     ) as exists;`,
  );

  if (!tableCheck.rows[0]?.exists) {
    return {
      applied: [],
      pending: localMigrations,
      isUpToDate: false,
    };
  }

  const result = await client.query<{
    migration_number: number;
    name: string;
    checksum_sha256: string;
    applied_at: Date;
  }>(
    `SELECT migration_number, name, checksum_sha256, applied_at
     FROM schema_migrations
     ORDER BY migration_number ASC;`,
  );

  const appliedRows = result.rows;
  const applied: AppliedMigration[] = [];

  for (let i = 0; i < appliedRows.length; i++) {
    const row = appliedRows[i]!;
    const expectedNum = i + 1;

    if (row.migration_number !== expectedNum) {
      throw new DatabaseError(
        `Database migration numbering gap or order corruption detected: row ${i} has number ${row.migration_number}, expected ${expectedNum}`,
      );
    }

    const local = localMigrations.find((m) => m.number === row.migration_number);
    if (!local) {
      throw new DatabaseError(
        `Drift detected: applied migration ${String(row.migration_number).padStart(4, '0')} ("${row.name}") is missing from local migrations`,
      );
    }

    if (local.checksumSha256 !== row.checksum_sha256) {
      throw new DatabaseError(
        `Drift detected: checksum mismatch for migration ${String(row.migration_number).padStart(4, '0')} ("${row.name}")`,
      );
    }

    if (local.name !== row.name) {
      throw new DatabaseError(
        `Drift detected: name mismatch for migration ${String(row.migration_number).padStart(4, '0')}`,
      );
    }

    applied.push({
      migrationNumber: row.migration_number,
      name: row.name,
      checksumSha256: row.checksum_sha256,
      appliedAt: row.applied_at,
    });
  }

  const appliedCount = applied.length;
  const pending = localMigrations.slice(appliedCount);

  return {
    applied,
    pending,
    isUpToDate: pending.length === 0,
  };
}

export async function executeMigrations(
  client: pg.ClientBase,
  localMigrations: readonly MigrationFile[],
  onProgress?: ((migration: MigrationFile, durationMs: number) => void) | undefined,
): Promise<{ appliedCount: number }> {
  const status = await fetchMigrationStatus(client, localMigrations);
  if (status.isUpToDate) {
    return { appliedCount: 0 };
  }

  let count = 0;
  for (const migration of status.pending) {
    const startTime = Date.now();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations (migration_number, name, checksum_sha256, applied_at)
         VALUES ($1, $2, $3, NOW());`,
        [migration.number, migration.name, migration.checksumSha256],
      );
      await client.query('COMMIT');
      count++;
      const duration = Date.now() - startTime;
      onProgress?.(migration, duration);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback failure ignored
      }
      throw sanitizeDatabaseError(err, `Migration ${migration.filename} failed during execution`);
    }
  }

  return { appliedCount: count };
}

export async function runMigrationCommand(
  databaseUrl: string,
  ssl: boolean | pg.ConnectionConfig['ssl'] = false,
  options?: RunMigrationsOptions,
): Promise<{ appliedCount: number }> {
  const migrationsDir = options?.migrationsDir ?? getDefaultMigrationsDir();
  const localMigrations = discoverMigrations(migrationsDir);

  const connectionTimeoutMillis =
    options?.connectionTimeoutMs ?? DEFAULT_MIGRATION_CONNECTION_TIMEOUT_MS;
  const statementTimeoutMillis =
    options?.statementTimeoutMs ?? DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS;
  const lockTimeoutMs = options?.lockTimeoutMs ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_MS;

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl,
    connectionTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
  });

  try {
    await client.connect();
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to connect to migration database');
  }

  try {
    await acquireAdvisoryLock(client, MIGRATION_ADVISORY_LOCK_ID, lockTimeoutMs);
    const result = await executeMigrations(client, localMigrations, options?.onProgress);
    return result;
  } finally {
    await releaseAdvisoryLock(client, MIGRATION_ADVISORY_LOCK_ID);
    await client.end();
  }
}

export async function checkMigrationStatusCommand(
  databaseUrl: string,
  ssl: boolean | pg.ConnectionConfig['ssl'] = false,
  options?: {
    readonly migrationsDir?: string;
    readonly connectionTimeoutMs?: number;
    readonly statementTimeoutMs?: number;
    readonly lockTimeoutMs?: number;
  },
): Promise<MigrationStatus> {
  const migrationsDir = options?.migrationsDir ?? getDefaultMigrationsDir();
  const localMigrations = discoverMigrations(migrationsDir);

  const connectionTimeoutMillis =
    options?.connectionTimeoutMs ?? DEFAULT_MIGRATION_CONNECTION_TIMEOUT_MS;
  const statementTimeoutMillis =
    options?.statementTimeoutMs ?? DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MS;
  const lockTimeoutMs = options?.lockTimeoutMs ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_MS;

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl,
    connectionTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
  });

  try {
    await client.connect();
  } catch (err) {
    throw sanitizeDatabaseError(err, 'Failed to connect to migration database');
  }

  try {
    await acquireAdvisoryLock(client, MIGRATION_ADVISORY_LOCK_ID, lockTimeoutMs);
    return await fetchMigrationStatus(client, localMigrations);
  } finally {
    await releaseAdvisoryLock(client, MIGRATION_ADVISORY_LOCK_ID);
    await client.end();
  }
}
