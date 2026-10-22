import {
  loadConfig,
  loadDatabaseConfig,
  type AppConfig,
  type DatabaseConfig,
} from '@affiliate-content-os/config';
import { createDatabase } from '@affiliate-content-os/infrastructure/database';
import { startWorker } from './runner.js';

async function main(): Promise<void> {
  let config: AppConfig;
  let databaseConfig: DatabaseConfig;

  try {
    config = loadConfig(process.env);
    databaseConfig = loadDatabaseConfig(process.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown configuration error';
    console.error(`Worker process startup failed: ${message}`);
    process.exit(1);
  }

  const database = createDatabase(databaseConfig);

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
    await startWorker({ config, database });
    console.log('Worker process stopped gracefully');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Worker process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
