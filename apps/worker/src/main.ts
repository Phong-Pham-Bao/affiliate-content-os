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

  try {
    await startWorker({ config });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Worker process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
