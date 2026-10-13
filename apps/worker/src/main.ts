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

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

async function main(): Promise<void> {
  try {
    await startWorker();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Worker process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
