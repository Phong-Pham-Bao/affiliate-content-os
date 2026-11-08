import {
  loadConfig,
  loadDatabaseConfig,
  loadAuthConfig,
  loadAIConfig,
  readAndValidateSslCaFile,
  getRedactedConfigMetadata,
  getRedactedDatabaseMetadata,
  getRedactedAuthConfigMetadata,
  type AppConfig,
  type DatabaseConfig,
  type AuthConfig,
  type AIConfig,
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
import { PostgresCatalogAdapter } from '@affiliate-content-os/infrastructure/catalog';
import { PostgresAnalysisAdapter } from '@affiliate-content-os/infrastructure/analysis';
import { SystemClock, DefaultIdGenerator } from '@affiliate-content-os/application';
import { startApiServer } from './server.js';
import type { AuthDependencies } from './auth/index.js';
import type { WorkspaceRouteDependencies } from './workspaces/index.js';
import type { CatalogRouteDependencies } from './catalog/index.js';
import type { AnalysisRouteDependencies } from './analysis/index.js';
import { PostgresWorkforceAdapter } from '@affiliate-content-os/infrastructure/workforce';
import type { WorkforceRouteDependencies } from './workforce/index.js';

async function main(): Promise<void> {
  let config: AppConfig;
  let databaseConfig: DatabaseConfig;
  let authConfig: AuthConfig;
  let aiConfig: AIConfig;
  let sslCaContent: string | undefined;

  try {
    config = loadConfig(process.env);
    databaseConfig = loadDatabaseConfig(process.env);
    authConfig = loadAuthConfig(process.env);
    aiConfig = loadAIConfig(process.env);
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
  const clock = new SystemClock();
  const idGenerator = new DefaultIdGenerator();

  let resolvedAuthDeps: AuthDependencies | undefined;

  const authProvider = async (signal: AbortSignal): Promise<AuthDependencies> => {
    if (resolvedAuthDeps) {
      return resolvedAuthDeps;
    }
    if (!authConfig.enabled) {
      resolvedAuthDeps = {
        config: authConfig,
        appBaseUrl: config.appBaseUrl,
      };
      return resolvedAuthDeps;
    }

    const oidcAdapter = await discoverOidcAdapter(
      {
        issuer: authConfig.issuer!,
        clientId: authConfig.clientId!,
        clientSecret: authConfig.clientSecret!,
        redirectUri: authConfig.redirectUri!,
      },
      { signal },
    );

    const cryptoAdapter = createAuthCryptoAdapter(
      authConfig.transactionEncryptionKeyBase64Url!,
      authConfig.transactionKeyVersion!,
    );

    resolvedAuthDeps = {
      config: authConfig,
      appBaseUrl: config.appBaseUrl,
      now: () => clock.now(),
      generateId: () => idGenerator.generateId(),
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
    return resolvedAuthDeps;
  };

  const workspaceProvider = async (signal: AbortSignal): Promise<WorkspaceRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      workspacePersistence: tenancyAdapter,
      workspaceAuthorization: tenancyAdapter,
      userDirectory: tenancyAdapter,
      clock,
      idGenerator,
    };
  };

  const catalogProvider = async (signal: AbortSignal): Promise<CatalogRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      catalogPersistence: catalogAdapter,
      workspaceAuthorization: tenancyAdapter,
      clock,
      idGenerator,
    };
  };

  const analysisProvider = async (signal: AbortSignal): Promise<AnalysisRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      workspaceAuthorization: tenancyAdapter,
      catalogPersistence: catalogAdapter,
      analysisPersistence: analysisAdapter,
      aiRunPersistence: analysisAdapter,
      operationPersistence: analysisAdapter,
      enqueueTxPort: analysisAdapter,
      persistTxPort: analysisAdapter,
      aiPolicyPort: analysisAdapter,
      aiModelConfig: aiConfig.enabled
        ? {
            provider: 'google',
            model: aiConfig.geminiModel,
            promptTemplate: 'product_analysis_v1',
            promptVersion: '1.0.0',
            inputSchemaVersion: 1,
            outputSchemaVersion: 1,
            estimatedCostMicrounits: aiConfig.estimatedCostMicrounits,
          }
        : undefined,
      clock,
      idGenerator,
    };
  };

  const workforceProvider = async (signal: AbortSignal): Promise<WorkforceRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      workforcePersistence: workforceAdapter,
      workspaceAuthorization: tenancyAdapter,
      catalogPersistence: catalogAdapter,
      analysisPersistence: analysisAdapter,
      idGenerator,
      clock,
    };
  };

  try {
    await startApiServer({
      config,
      database,
      auth: authProvider,
      workspaces: workspaceProvider,
      catalog: catalogProvider,
      analysis: analysisProvider,
      workforce: workforceProvider,
    });
    const meta = getRedactedConfigMetadata(config);
    const dbMeta = getRedactedDatabaseMetadata(databaseConfig);
    const authMeta = getRedactedAuthConfigMetadata(authConfig);
    console.log(
      `API process started on http://${meta.apiHost}:${meta.apiPort} (nodeEnv: ${meta.nodeEnv}, db: ${dbMeta.hasDatabaseUrl}, auth: ${authMeta.enabled})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
