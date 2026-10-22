import { fileURLToPath } from 'node:url';
import {
  loadMigrationConfig,
  loadTestAdminDatabaseConfig,
  readAndValidateSslCaFile,
} from '@affiliate-content-os/config';
import { resolveSslOptions } from '../ssl.js';
import { checkMigrationStatusCommand, runMigrationCommand } from './runner.js';
import { validateMigrations } from './validate.js';

export async function runMigrationCli(args: readonly string[]): Promise<void> {
  const command = args[0];

  if (!command || !['migrate', 'status', 'validate'].includes(command)) {
    console.error('Usage: db:migrate | db:migrate:status | db:migrate:validate');
    process.exit(1);
  }

  if (command === 'migrate') {
    const config = loadMigrationConfig(process.env);
    let sslCaContent: string | undefined;
    if (config.sslMode === 'verify-full' && config.sslCaFile) {
      sslCaContent = readAndValidateSslCaFile(config.sslCaFile);
    }
    const ssl = resolveSslOptions(config.sslMode, sslCaContent);

    console.log('[db:migrate] Discovering and executing pending migrations...');
    const result = await runMigrationCommand(config.migrationDatabaseUrl, ssl, {
      connectionTimeoutMs: config.connectionTimeoutMs,
      statementTimeoutMs: config.statementTimeoutMs,
      onProgress: (m, durationMs) => {
        console.log(`[db:migrate] Applied ${m.filename} in ${durationMs}ms`);
      },
    });

    if (result.appliedCount === 0) {
      console.log('[db:migrate] Database is already up to date. 0 migrations applied.');
    } else {
      console.log(`[db:migrate] Successfully applied ${result.appliedCount} migration(s).`);
    }
    return;
  }

  if (command === 'status') {
    const config = loadMigrationConfig(process.env);
    let sslCaContent: string | undefined;
    if (config.sslMode === 'verify-full' && config.sslCaFile) {
      sslCaContent = readAndValidateSslCaFile(config.sslCaFile);
    }
    const ssl = resolveSslOptions(config.sslMode, sslCaContent);

    const status = await checkMigrationStatusCommand(config.migrationDatabaseUrl, ssl, {
      connectionTimeoutMs: config.connectionTimeoutMs,
      statementTimeoutMs: config.statementTimeoutMs,
    });

    console.log(`[db:migrate:status] Applied migrations: ${status.applied.length}`);
    for (const a of status.applied) {
      console.log(
        `  - ${String(a.migrationNumber).padStart(4, '0')}_${a.name} (applied: ${a.appliedAt.toISOString()})`,
      );
    }

    if (status.pending.length > 0) {
      console.error(`[db:migrate:status] Pending migrations: ${status.pending.length}`);
      for (const p of status.pending) {
        console.error(`  - ${p.filename}`);
      }
      process.exit(1);
    }

    if (!status.isUpToDate) {
      console.error('[db:migrate:status] Database is not up to date.');
      process.exit(1);
    }

    console.log('[db:migrate:status] Database schema is fully up to date with zero drift.');
    return;
  }

  if (command === 'validate') {
    const config = loadTestAdminDatabaseConfig(process.env);
    let sslCaContent: string | undefined;
    if (config.sslMode === 'verify-full' && config.sslCaFile) {
      sslCaContent = readAndValidateSslCaFile(config.sslCaFile);
    }
    const ssl = resolveSslOptions(config.sslMode, sslCaContent);

    console.log('[db:migrate:validate] Validating migrations against isolated database...');
    const result = await validateMigrations({
      adminConfig: config,
      ssl,
      sslCaContent,
    });

    console.log(
      `[db:migrate:validate] Migration validation passed: ${result.appliedCount} applied, second run ${result.secondRunCount} (no-op), ${result.verifiedChecksums} checksums verified. Cleaned up ${result.isolatedDatabaseName}.`,
    );
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  (process.argv[1] === currentFilePath ||
    process.argv[1].endsWith('cli.js') ||
    process.argv[1].endsWith('cli.ts'))
) {
  runMigrationCli(process.argv.slice(2)).catch((err) => {
    console.error('[db:migrate] Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
