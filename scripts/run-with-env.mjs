import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const defaultEnvPath = path.join(rootDir, '.env');

export function prepareEnvironment(options = {}) {
  const envFile = options.envPath ?? defaultEnvPath;
  const isCi = options.isCi ?? (process.env['CI'] === 'true' || process.env['CI'] === '1');

  if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
  } else if (!isCi) {
    console.error('Run corepack pnpm env:local');
    process.exit(1);
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
}

export function runChildWithEnv(argv) {
  let targetNodeEnv;
  const commandArgs = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && arg.startsWith('--set-node-env=')) {
      targetNodeEnv = arg.slice('--set-node-env='.length);
    } else if (arg) {
      commandArgs.push(arg);
    }
  }

  if (commandArgs.length === 0) {
    console.error('No command specified to run with environment.');
    process.exit(1);
  }

  prepareEnvironment({ setNodeEnv: targetNodeEnv });

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

  child.on('error', (err) => {
    console.error(`Failed to spawn command "${cmd}":`, err.message);
    process.exit(1);
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runChildWithEnv(process.argv.slice(2));
}
