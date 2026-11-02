import {
  loadConfig,
  loadDatabaseConfig,
  loadAuthConfig,
  readAndValidateSslCaFile,
  getRedactedConfigMetadata,
  getRedactedDatabaseMetadata,
  getRedactedAuthConfigMetadata,
  type AppConfig,
  type DatabaseConfig,
  type AuthConfig,
} from '@affiliate-content-os/config';
import { createDatabase } from '@affiliate-content-os/infrastructure/database';
import {
  createAuthCryptoAdapter,
  createPostgresLoginTransactionAdapter,
  createPostgresSessionAdapter,
  createPostgresWorkspaceSummaryAdapter,
  discoverOidcAdapter,
} from '@affiliate-content-os/infrastructure/auth';
import { createPostgresTenancyAdapter } from '@affiliate-content-os/infrastructure/tenancy';
import { SystemClock, DefaultIdGenerator } from '@affiliate-content-os/application';
import { startApiServer } from './server.js';
import type { AuthDependencies } from './auth/index.js';

async function main(): Promise<void> {
  let config: AppConfig;
  let databaseConfig: DatabaseConfig;
  let authConfig: AuthConfig;
  let sslCaContent: string | undefined;

  try {
    config = loadConfig(process.env);
    databaseConfig = loadDatabaseConfig(process.env);
    authConfig = loadAuthConfig(process.env);
    if (databaseConfig.sslMode === 'verify-full' && databaseConfig.sslCaFile) {
      sslCaContent = readAndValidateSslCaFile(databaseConfig.sslCaFile);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown configuration error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }

  const database = createDatabase(databaseConfig, { sslCaContent });

  let authDeps: AuthDependencies;
  if (authConfig.enabled) {
    try {
      const oidcAdapter = await discoverOidcAdapter({
        issuer: authConfig.issuer!,
        clientId: authConfig.clientId!,
        clientSecret: authConfig.clientSecret!,
        redirectUri: authConfig.redirectUri!,
      });

      const cryptoAdapter = createAuthCryptoAdapter(
        authConfig.transactionEncryptionKeyBase64Url!,
        authConfig.transactionKeyVersion!,
      );

      const tenancyAdapter = createPostgresTenancyAdapter(database);
      const clock = new SystemClock();
      const idGenerator = new DefaultIdGenerator();

      authDeps = {
        config: authConfig,
        appBaseUrl: config.appBaseUrl,
        oidcProtocolPort: oidcAdapter,
        loginTransactionStore: createPostgresLoginTransactionAdapter(database),
        sessionStore: createPostgresSessionAdapter(database),
        userDirectory: tenancyAdapter,
        identityResolution: {
          identityDirectory: tenancyAdapter,
          clock,
          idGenerator,
        },
        workspaceSummary: createPostgresWorkspaceSummaryAdapter(database),
        crypto: cryptoAdapter,
      };
    } catch (err) {
      await database.close().catch(() => {});
      const message = err instanceof Error ? err.message : 'Auth startup failure';
      console.error(`API process startup failed: ${message}`);
      process.exit(1);
    }
  } else {
    authDeps = {
      config: authConfig,
      appBaseUrl: config.appBaseUrl,
    };
  }

  try {
    await startApiServer({ config, database, auth: authDeps });
    const metadata = getRedactedConfigMetadata(config);
    const dbMetadata = getRedactedDatabaseMetadata(databaseConfig);
    const authMetadata = getRedactedAuthConfigMetadata(authConfig);
    console.log(
      `API process started on http://${metadata.apiHost}:${metadata.apiPort} (nodeEnv: ${metadata.nodeEnv}, db: ${dbMetadata.hasDatabaseUrl}, auth: ${authMetadata.enabled})`,
    );
  } catch (err) {
    await database.close().catch(() => {});
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
