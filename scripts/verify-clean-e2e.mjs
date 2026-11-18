import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { applyPlaywrightEnvironment } from './run-with-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Safety contract: NEVER rename, move, delete, or edit the user's .env file.
// Clean CI environment verification is enforced via SKIP_ENV_LOADING='true' and explicit cleanEnv.

const cleanEnv = {
  ...process.env,
  CI: 'true',
  SKIP_ENV_LOADING: 'true',
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL:
    process.env.DATABASE_URL || 'postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev',
  MIGRATION_DATABASE_URL:
    process.env.MIGRATION_DATABASE_URL ||
    'postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev',
  TEST_DATABASE_ADMIN_URL:
    process.env.TEST_DATABASE_ADMIN_URL ||
    'postgresql://acos_local:acos_local_only@127.0.0.1:5432/postgres',
  TEST_DATABASE_DISPOSABLE: 'YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED',
  DATABASE_SSL_MODE: 'disable',
};

// Ensure root .env / local WEB_API_BASE_URL is not inherited by clean verification
delete cleanEnv.WEB_API_BASE_URL;

// Apply Playwright loader flags
applyPlaywrightEnvironment(cleanEnv);

console.log(
  '[Clean E2E Verification] Running full-stack Playwright E2E in clean environment without .env dependency...',
);

const commandArgs = [
  'node',
  'scripts/run-with-env.mjs',
  'playwright',
  'test',
  'e2e/social-connections-flow.spec.ts',
];

const child =
  process.platform === 'win32'
    ? spawn(
        commandArgs
          .map((arg) => (/[ \t"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
          .join(' '),
        {
          cwd: rootDir,
          env: cleanEnv,
          stdio: 'inherit',
          shell: true,
        },
      )
    : spawn(commandArgs[0], commandArgs.slice(1), {
        cwd: rootDir,
        env: cleanEnv,
        stdio: 'inherit',
      });

// Bounded timeout: 180 seconds maximum runtime for clean E2E
const TIMEOUT_MS = 180000;
const timer = setTimeout(() => {
  console.error(
    `[Clean E2E Verification] Timed out after ${TIMEOUT_MS / 1000}s. Terminating subprocess tree...`,
  );
  if (child.pid && !child.killed) {
    if (process.platform === 'win32') {
      try {
        spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: 'ignore' });
      } catch {
        // Ignore
      }
    } else {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }
  }
  process.exit(124);
}, TIMEOUT_MS);

function forwardKill() {
  clearTimeout(timer);
  if (child.pid && !child.killed) {
    if (process.platform === 'win32') {
      try {
        spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: 'ignore' });
      } catch {
        // Ignore
      }
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }
  }
}

process.on('SIGINT', () => {
  forwardKill();
  process.exit(130);
});

process.on('SIGTERM', () => {
  forwardKill();
  process.exit(143);
});

child.on('error', (err) => {
  clearTimeout(timer);
  console.error('[Clean E2E Verification] Spawn error:', err);
  process.exit(1);
});

child.on('close', (code, signal) => {
  clearTimeout(timer);
  if (signal === 'SIGINT') process.exit(130);
  if (signal === 'SIGTERM') process.exit(143);
  if (code !== 0) {
    console.error('[Clean E2E Verification] Playwright tests failed with status:', code);
    process.exit(code ?? 1);
  } else {
    console.log('[Clean E2E Verification] All clean CI E2E tests PASSED successfully.');
    process.exit(0);
  }
});
