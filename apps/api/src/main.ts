import { getRedactedConfigMetadata } from '@affiliate-content-os/config';
import { startApiServer } from './server.js';

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
    const { config } = await startApiServer();
    const metadata = getRedactedConfigMetadata(config);
    console.log(
      `API process started on http://${metadata.apiHost}:${metadata.apiPort} (nodeEnv: ${metadata.nodeEnv})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
