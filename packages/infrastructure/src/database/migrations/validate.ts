import type { TestAdminDatabaseConfig } from '@affiliate-content-os/config';
import pg from 'pg';
import { DatabaseError, sanitizeDatabaseError } from '../errors.js';
import { discoverMigrations, getDefaultMigrationsDir } from './discovery.js';
import { checkMigrationStatusCommand, runMigrationCommand } from './runner.js';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  generateTestDatabaseName,
} from './safety.js';

export interface ValidateMigrationsOptions {
  readonly adminConfig: TestAdminDatabaseConfig;
  readonly ssl?: boolean | pg.ConnectionConfig['ssl'] | undefined;
  readonly sslCaContent?: string | undefined;
  readonly migrationsDir?: string | undefined;
  readonly connectionTimeoutMs?: number | undefined;
  readonly statementTimeoutMs?: number | undefined;
  readonly effectiveNodeEnv: string;
  readonly isCi: boolean;
}

export async function validateMigrations(options: ValidateMigrationsOptions): Promise<{
  readonly isolatedDatabaseName: string;
  readonly appliedCount: number;
  readonly secondRunCount: number;
  readonly verifiedChecksums: number;
}> {
  const migrationsDir = options.migrationsDir ?? getDefaultMigrationsDir();
  const localMigrations = discoverMigrations(migrationsDir);
  const targetDbName = generateTestDatabaseName();

  let databaseCreated = false;
  const safetyOptions = {
    effectiveNodeEnv: options.effectiveNodeEnv,
    isCi: options.isCi,
    sslCaContent: options.sslCaContent,
    onDatabaseCreated: () => {
      databaseCreated = true;
    },
  };

  const connectionTimeoutMs =
    options.connectionTimeoutMs ?? options.adminConfig.connectionTimeoutMs;
  const statementTimeoutMs = options.statementTimeoutMs ?? options.adminConfig.statementTimeoutMs;

  let isolatedDbUrl: string | undefined;
  let primaryError: unknown;
  let validationResult:
    | {
        readonly isolatedDatabaseName: string;
        readonly appliedCount: number;
        readonly secondRunCount: number;
        readonly verifiedChecksums: number;
      }
    | undefined;

  try {
    isolatedDbUrl = await createIsolatedDatabase(options.adminConfig, targetDbName, safetyOptions);

    // 1. Initial migration run on empty database
    const initialRun = await runMigrationCommand(isolatedDbUrl, options.ssl, {
      migrationsDir,
      connectionTimeoutMs,
      statementTimeoutMs,
    });
    if (initialRun.appliedCount !== localMigrations.length) {
      throw new DatabaseError(
        `Migration validation failed: expected ${localMigrations.length} applied migrations, but got ${initialRun.appliedCount}`,
      );
    }

    // 2. Status verification
    const status = await checkMigrationStatusCommand(isolatedDbUrl, options.ssl, {
      migrationsDir,
      connectionTimeoutMs,
      statementTimeoutMs,
    });
    if (!status.isUpToDate || status.pending.length > 0) {
      throw new DatabaseError(
        'Migration validation failed: status is not up to date after initial run',
      );
    }

    // 3. Second run must be a no-op
    const secondRun = await runMigrationCommand(isolatedDbUrl, options.ssl, {
      migrationsDir,
      connectionTimeoutMs,
      statementTimeoutMs,
    });
    if (secondRun.appliedCount !== 0) {
      throw new DatabaseError(
        `Migration validation failed: second run was not a no-op (applied ${secondRun.appliedCount} migrations)`,
      );
    }

    // 4. Verify recorded schema_migrations rows and checksums
    const client = new pg.Client({
      connectionString: isolatedDbUrl,
      ssl: options.ssl,
      connectionTimeoutMillis: connectionTimeoutMs,
      statement_timeout: statementTimeoutMs,
    });
    try {
      await client.connect();
      const res = await client.query<{
        migration_number: number;
        name: string;
        checksum_sha256: string;
      }>(
        'SELECT migration_number, name, checksum_sha256 FROM schema_migrations ORDER BY migration_number ASC;',
      );

      if (res.rows.length !== localMigrations.length) {
        throw new DatabaseError(
          'Migration validation failed: schema_migrations row count mismatch',
        );
      }

      for (let i = 0; i < localMigrations.length; i++) {
        const local = localMigrations[i]!;
        const row = res.rows[i]!;
        if (
          row.migration_number !== local.number ||
          row.name !== local.name ||
          row.checksum_sha256 !== local.checksumSha256
        ) {
          throw new DatabaseError(
            `Migration validation failed: checksum/name mismatch for migration ${local.filename}`,
          );
        }
      }
    } finally {
      await client.end().catch(() => {});
    }

    validationResult = {
      isolatedDatabaseName: targetDbName,
      appliedCount: initialRun.appliedCount,
      secondRunCount: secondRun.appliedCount,
      verifiedChecksums: localMigrations.length,
    };
  } catch (err) {
    primaryError = err;
  }

  let cleanupError: unknown;
  if (databaseCreated) {
    try {
      await dropIsolatedDatabase(options.adminConfig, targetDbName, safetyOptions);
    } catch (err) {
      cleanupError = err;
    }
  }

  if (primaryError && cleanupError) {
    const primarySanitized = sanitizeDatabaseError(primaryError);
    const cleanupSanitized = sanitizeDatabaseError(cleanupError);
    throw new DatabaseError(
      `Migration validation failed: ${primarySanitized.message}; cleanup failed: ${cleanupSanitized.message}`,
    );
  }

  if (cleanupError) {
    throw sanitizeDatabaseError(cleanupError);
  }

  if (primaryError) {
    throw sanitizeDatabaseError(primaryError);
  }

  return validationResult!;
}
