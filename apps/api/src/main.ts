import {
  loadConfig,
  loadDatabaseConfig,
  loadAuthConfig,
  loadAIConfig,
  loadSocialConfig,
  readAndValidateSslCaFile,
  getRedactedConfigMetadata,
  getRedactedDatabaseMetadata,
  getRedactedAuthConfigMetadata,
  getRedactedSocialConfigMetadata,
  type AppConfig,
  type DatabaseConfig,
  type AuthConfig,
  type AIConfig,
  type SocialConfig,
} from '@affiliate-content-os/config';
import { createDatabase } from '@affiliate-content-os/infrastructure/database';
import { createPostgresTenancyAdapter } from '@affiliate-content-os/infrastructure/tenancy';
import { PostgresCatalogAdapter } from '@affiliate-content-os/infrastructure/catalog';
import { PostgresAnalysisAdapter } from '@affiliate-content-os/infrastructure/analysis';
import { PostgresWorkforceAdapter } from '@affiliate-content-os/infrastructure/workforce';
import {
  LocalSocialCredentialProtector,
  FakeSocialAuthAdapter,
  PostgresSocialPersistenceAdapter,
} from '@affiliate-content-os/infrastructure/social';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import {
  SystemClock,
  DefaultIdGenerator,
  type SocialAuthAdapter,
} from '@affiliate-content-os/application';
import { startApiServer } from './server.js';
import { createRouteProviders } from './route-providers.js';

async function main(): Promise<void> {
  let config: AppConfig;
  let databaseConfig: DatabaseConfig;
  let authConfig: AuthConfig;
  let aiConfig: AIConfig;
  let socialConfig: SocialConfig;
  let sslCaContent: string | undefined;

  try {
    config = loadConfig(process.env);
    databaseConfig = loadDatabaseConfig(process.env);
    authConfig = loadAuthConfig(process.env);
    aiConfig = loadAIConfig(process.env);
    socialConfig = loadSocialConfig(process.env);
    if (databaseConfig.sslMode === 'verify-full' && databaseConfig.sslCaFile) {
      sslCaContent = readAndValidateSslCaFile(databaseConfig.sslCaFile);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown configuration error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }

  const database = createDatabase(databaseConfig, { sslCaContent });
  const tenancyAdapter = createPostgresTenancyAdapter(database);
  const catalogAdapter = new PostgresCatalogAdapter(database);
  const analysisAdapter = new PostgresAnalysisAdapter(database.pool!);
  const workforceAdapter = new PostgresWorkforceAdapter(database.pool!);
  const socialPersistence = new PostgresSocialPersistenceAdapter(database);
  const socialProtector =
    socialConfig.enabled && socialConfig.credentialEncryptionKeyBase64Url
      ? new LocalSocialCredentialProtector(
          socialConfig.credentialEncryptionKeyBase64Url,
          socialConfig.credentialKeyVersion ?? 'v1',
        )
      : undefined;

  const socialAdapters = new Map<SocialPlatform, SocialAuthAdapter>();
  if (socialConfig.enabled && socialConfig.fakeAdapterEnabled && config.nodeEnv !== 'production') {
    socialAdapters.set(
      'threads',
      new FakeSocialAuthAdapter({
        platform: 'threads',
        authBaseUrl: config.appBaseUrl,
      }),
    );
    socialAdapters.set(
      'tiktok',
      new FakeSocialAuthAdapter({
        platform: 'tiktok',
        authBaseUrl: config.appBaseUrl,
      }),
    );
  }

  const clock = new SystemClock();
  const idGenerator = new DefaultIdGenerator();

  const providers = createRouteProviders({
    database,
    tenancyAdapter,
    catalogAdapter,
    analysisAdapter,
    workforceAdapter,
    socialPersistence,
    socialProtector,
    socialAdapters,
    clock,
    idGenerator,
    config,
    authConfig,
    aiConfig,
    socialConfig,
  });

  try {
    await startApiServer({
      config,
      database,
      auth: providers.authProvider,
      workspaces: providers.workspaceProvider,
      catalog: providers.catalogProvider,
      analysis: providers.analysisProvider,
      workforce: providers.workforceProvider,
      social: providers.socialProvider,
    });
    const meta = getRedactedConfigMetadata(config);
    const dbMeta = getRedactedDatabaseMetadata(databaseConfig);
    const authMeta = getRedactedAuthConfigMetadata(authConfig);
    const socialMeta = getRedactedSocialConfigMetadata(socialConfig);
    console.log(
      `API process started on http://${meta.apiHost}:${meta.apiPort} (nodeEnv: ${meta.nodeEnv}, db: ${dbMeta.hasDatabaseUrl}, auth: ${authMeta.enabled}, social: ${socialMeta.enabled})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
