import { loadConfig, type AppConfig } from '@affiliate-content-os/config';
import { startWorker } from './runner.js';

try {
  process.loadEnvFile();
} catch {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // No .env file present; rely on process.env
  }
}

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown configuration error';
    console.error(`Worker process startup failed: ${message}`);
    process.exit(1);
  }

  // On Windows, child processes cannot receive POSIX signals from parent processes via kill().
  // When running non-interactively in test mode, allow signaling via stdin.
  if (config.nodeEnv === 'test' && !process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      const line = chunk.toString().trim();
      if (line === 'SIGINT') {
        process.emit('SIGINT');
      } else if (line === 'SIGTERM') {
        process.emit('SIGTERM');
      }
    });
  }

  try {
    await startWorker({ config });
    console.log('Worker process stopped gracefully');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Worker process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
