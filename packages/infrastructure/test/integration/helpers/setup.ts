import {
  loadTestAdminDatabaseConfig,
  readAndValidateSslCaFile,
  type TestAdminDatabaseConfig,
} from '@affiliate-content-os/config';
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  generateTestDatabaseName,
} from '../../../src/database/migrations/safety.js';
import { resolveSslOptions } from '../../../src/database/ssl.js';
import { runMigrationCommand } from '../../../src/database/migrations/runner.js';
import { DatabaseError, sanitizeDatabaseError } from '../../../src/database/errors.js';

export interface TestDatabaseContext {
  readonly dbName: string;
  readonly dbUrl: string;
  readonly adminConfig: TestAdminDatabaseConfig;
  readonly cleanup: () => Promise<void>;
}

export interface SetupIsolatedOptions {
  readonly rawEnv?: unknown;
  readonly effectiveNodeEnv?: string;
  readonly isCi?: boolean;
  readonly skipMigrations?: boolean;
}

export async function setupIsolatedTestDatabase(
  options?: SetupIsolatedOptions,
): Promise<TestDatabaseContext> {
  const adminConfig = loadTestAdminDatabaseConfig(options?.rawEnv ?? process.env);
  const dbName = generateTestDatabaseName();

  let sslCaContent: string | undefined;
  if (adminConfig.sslMode === 'verify-full' && adminConfig.sslCaFile) {
    sslCaContent = readAndValidateSslCaFile(adminConfig.sslCaFile);
  }

  let databaseCreated = false;
  const safetyOptions = {
    effectiveNodeEnv:
      options?.effectiveNodeEnv ??
      (typeof process.env['NODE_ENV'] === 'string' ? process.env['NODE_ENV'] : ''),
    isCi: options?.isCi ?? (process.env['CI'] === 'true' || process.env['CI'] === '1'),
    sslCaContent,
    onDatabaseCreated: () => {
      databaseCreated = true;
    },
  };

  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }
    await dropIsolatedDatabase(adminConfig, dbName, safetyOptions);
    cleanedUp = true;
  };

  try {
    const dbUrl = await createIsolatedDatabase(adminConfig, dbName, safetyOptions);

    if (!options?.skipMigrations) {
      // Apply migrations before handing the database to test suite
      const migrationSsl = resolveSslOptions(adminConfig.sslMode, sslCaContent);
      await runMigrationCommand(dbUrl, migrationSsl, {
        connectionTimeoutMs: adminConfig.connectionTimeoutMs,
        statementTimeoutMs: adminConfig.statementTimeoutMs,
      });
    }

    return {
      dbName,
      dbUrl,
      adminConfig,
      cleanup,
    };
  } catch (primaryErr) {
    if (databaseCreated) {
      try {
        await cleanup();
      } catch (cleanupErr) {
        throw new DatabaseError(
          `Setup failed: ${sanitizeDatabaseError(primaryErr).message}; Cleanup also failed: ${sanitizeDatabaseError(cleanupErr).message}`,
        );
      }
    }
    throw sanitizeDatabaseError(primaryErr);
  }
}
