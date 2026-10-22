import {
  loadConfig,
  loadDatabaseConfig,
  readAndValidateSslCaFile,
  getRedactedConfigMetadata,
  getRedactedDatabaseMetadata,
  type AppConfig,
  type DatabaseConfig,
} from '@affiliate-content-os/config';
import { createDatabase } from '@affiliate-content-os/infrastructure/database';
import { startApiServer } from './server.js';

async function main(): Promise<void> {
  let config: AppConfig;
  let databaseConfig: DatabaseConfig;
  let sslCaContent: string | undefined;

  try {
    config = loadConfig(process.env);
    databaseConfig = loadDatabaseConfig(process.env);
    if (databaseConfig.sslMode === 'verify-full' && databaseConfig.sslCaFile) {
      sslCaContent = readAndValidateSslCaFile(databaseConfig.sslCaFile);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown configuration error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }

  const database = createDatabase(databaseConfig, { sslCaContent });

  try {
    await startApiServer({ config, database });
    const metadata = getRedactedConfigMetadata(config);
    const dbMetadata = getRedactedDatabaseMetadata(databaseConfig);
    console.log(
      `API process started on http://${metadata.apiHost}:${metadata.apiPort} (nodeEnv: ${metadata.nodeEnv}, db: ${dbMetadata.hasDatabaseUrl})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
