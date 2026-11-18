import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const defaultEnvPath = path.join(rootDir, '.env');

/**
 * Applies Node 24 on Windows workaround specifically for Playwright execution.
 * Scoped strictly to Playwright commands to prevent leaking into migrations, tests, or runtime.
 */
export function applyPlaywrightEnvironment(targetEnv = process.env) {
  targetEnv['PW_DISABLE_TS_ESM'] = '1';
  const existingNodeOptions = targetEnv['NODE_OPTIONS'] ?? '';
  if (!/(?:^|\s)--import\s+(?:tsx|"tsx")(?:\s|$)/.test(existingNodeOptions)) {
    targetEnv['NODE_OPTIONS'] = existingNodeOptions.trim()
      ? `${existingNodeOptions.trim()} --import tsx`
      : '--import tsx';
  }
  return targetEnv;
}

export function isPlaywrightCommand(commandArgs = []) {
  if (!Array.isArray(commandArgs) || commandArgs.length === 0) return false;
  const first = commandArgs[0] ?? '';
  return (
    first === 'playwright' ||
    first.endsWith('/playwright') ||
    first.endsWith('\\playwright') ||
    commandArgs.includes('playwright')
  );
}

export function prepareEnvironment(options = {}) {
  const skipEnvLoading =
    options.skipEnvLoading ??
    (process.env['SKIP_ENV_LOADING'] === 'true' || process.env['SKIP_ENV_LOADING'] === '1');
  const envFile = options.envPath ?? defaultEnvPath;
  const isCi = options.isCi ?? (process.env['CI'] === 'true' || process.env['CI'] === '1');

  if (!skipEnvLoading) {
    if (fs.existsSync(envFile)) {
      process.loadEnvFile(envFile);
    } else if (!isCi) {
      console.error('Run corepack pnpm env:local');
      process.exit(1);
    }
  }

  if (options.setNodeEnv) {
    process.env['NODE_ENV'] = options.setNodeEnv;
  }

  // Ensure local node_modules/.bin is on PATH so runtime tools like tsx resolve across platforms
  const binDir = path.join(rootDir, 'node_modules', '.bin');
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const currentPath = process.env[pathKey] ?? '';
  if (!currentPath.includes(binDir)) {
    process.env[pathKey] = `${binDir}${path.delimiter}${currentPath}`;
  }

  if (options.isPlaywright) {
    applyPlaywrightEnvironment(process.env);
  }
}

export function runChildWithEnv(argv) {
  let targetNodeEnv;
  let skipEnvLoading = false;
  const commandArgs = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && arg.startsWith('--set-node-env=')) {
      targetNodeEnv = arg.slice('--set-node-env='.length);
    } else if (arg === '--skip-env-loading') {
      skipEnvLoading = true;
    } else if (arg) {
      commandArgs.push(arg);
    }
  }

  if (commandArgs.length === 0) {
    console.error('No command specified to run with environment.');
    process.exit(1);
  }

  const isPlaywright = isPlaywrightCommand(commandArgs);
  prepareEnvironment({ setNodeEnv: targetNodeEnv, isPlaywright, skipEnvLoading });

  const [cmd, ...args] = commandArgs;
  if (!cmd) {
    console.error('No command specified to run with environment.');
    process.exit(1);
  }

  const child =
    process.platform === 'win32'
      ? spawn(
          commandArgs
            .map((arg) => (/[ \t"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
            .join(' '),
          {
            stdio: 'inherit',
            env: process.env,
            shell: true,
          },
        )
      : spawn(cmd, args, {
          stdio: 'inherit',
          env: process.env,
        });

  function killChildTree() {
    if (child.pid && !child.killed) {
      if (process.platform === 'win32') {
        try {
          spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: 'ignore' });
        } catch {
          // Ignore if already terminated
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
    killChildTree();
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    killChildTree();
    process.exit(143);
  });

  child.on('error', (err) => {
    console.error(`Failed to spawn command "${cmd}":`, err.message);
    process.exit(1);
  });

  child.on('close', (code, signal) => {
    if (signal === 'SIGINT') process.exit(130);
    if (signal === 'SIGTERM') process.exit(143);
    process.exit(code ?? 0);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runChildWithEnv(process.argv.slice(2));
}
