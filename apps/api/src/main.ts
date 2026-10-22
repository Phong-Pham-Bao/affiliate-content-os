import {
  loadConfig,
  getRedactedConfigMetadata,
  type AppConfig,
} from '@affiliate-content-os/config';
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

async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown configuration error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }

  try {
    await startApiServer({ config });
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
