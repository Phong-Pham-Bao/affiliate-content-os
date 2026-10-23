import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CONSECUTIVE_SUCCESSES = 5;
export const READINESS_TIMEOUT_MS = 30000;
export const RETRY_INTERVAL_MS = 250;

export function runComposeUp(options = {}) {
  const spawnFn = options.spawnSyncFn ?? spawnSync;
  const result = spawnFn('docker', ['compose', 'up', '-d', '--wait'], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    if (options.throwOnError) {
      throw new Error(`docker compose up exited with code ${result.status ?? 1}`);
    }
    process.exit(result.status ?? 1);
  }
}

export async function verifyAuthenticatedQueries(options = {}) {
  let pg = options.pgModule;
  if (!pg) {
    const req = createRequire(import.meta.resolve('../packages/infrastructure/package.json'));
    pg = req('pg');
  }

  const connectionString =
    options.connectionString ||
    process.env['DATABASE_URL'] ||
    `postgresql://${process.env['POSTGRES_USER']}:${process.env['POSTGRES_PASSWORD']}@127.0.0.1:5432/${process.env['POSTGRES_DB']}`;

  const timeoutMs = options.timeoutMs ?? READINESS_TIMEOUT_MS;
  const requiredSuccesses = options.requiredSuccesses ?? REQUIRED_CONSECUTIVE_SUCCESSES;
  const retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS;

  const deadline = Date.now() + timeoutMs;
  let consecutiveSuccesses = 0;
  let lastError;

  while (Date.now() < deadline) {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 3000,
      statement_timeout: 3000,
    });

    try {
      await client.connect();
      const res = await client.query('SELECT 1 as ready;');
      await client.end();

      if (res.rows?.[0]?.ready === 1) {
        consecutiveSuccesses += 1;
        if (consecutiveSuccesses >= requiredSuccesses) {
          if (!options.silent) {
            console.log(
              `[infra:up] PostgreSQL is fully ready and accepting authenticated queries (${requiredSuccesses}/${requiredSuccesses} verified).`,
            );
          }
          return { verified: true, attempts: consecutiveSuccesses };
        }
      } else {
        consecutiveSuccesses = 0;
      }
    } catch (err) {
      consecutiveSuccesses = 0;
      lastError = err;
      try {
        await client.end();
      } catch {
        // ignore client termination error
      }
    }

    await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  }

  const errorMsg = `[infra:up] PostgreSQL readiness verification timed out after ${timeoutMs}ms. Last error: ${lastError?.message ?? 'unknown'}`;
  if (!options.silent) {
    console.error(errorMsg);
  }
  if (options.throwOnError) {
    throw new Error(errorMsg);
  }
  process.exit(1);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && process.argv[1] === currentFilePath) {
  runComposeUp();
  await verifyAuthenticatedQueries();
}
