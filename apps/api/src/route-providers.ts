import type { AIConfig, AppConfig, AuthConfig, SocialConfig } from '@affiliate-content-os/config';
import type { Database } from '@affiliate-content-os/infrastructure/database';
import {
  createAuthCryptoAdapter,
  createPostgresLoginTransactionAdapter,
  createPostgresSessionAdapter,
  createPostgresWorkspaceSummaryAdapter,
  discoverOidcAdapter,
} from '@affiliate-content-os/infrastructure/auth';
import type { PostgresTenancyAdapter } from '@affiliate-content-os/infrastructure/tenancy';
import type { PostgresCatalogAdapter } from '@affiliate-content-os/infrastructure/catalog';
import type { PostgresAnalysisAdapter } from '@affiliate-content-os/infrastructure/analysis';
import type { PostgresWorkforceAdapter } from '@affiliate-content-os/infrastructure/workforce';
import type {
  LocalSocialCredentialProtector,
  PostgresSocialPersistenceAdapter,
} from '@affiliate-content-os/infrastructure/social';
import type {
  ClockPort,
  DefaultIdGenerator,
  SocialAuthAdapter,
} from '@affiliate-content-os/application';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import type { AuthDependencies } from './auth/index.js';
import type { WorkspaceRouteDependencies } from './workspaces/index.js';
import type { CatalogRouteDependencies } from './catalog/index.js';
import type { AnalysisRouteDependencies } from './analysis/index.js';
import type { WorkforceRouteDependencies } from './workforce/index.js';
import type { SocialRouteDependencies } from './social/index.js';

export interface RouteProvidersContext {
  readonly database: Database;
  readonly tenancyAdapter: PostgresTenancyAdapter;
  readonly catalogAdapter: PostgresCatalogAdapter;
  readonly analysisAdapter: PostgresAnalysisAdapter;
  readonly workforceAdapter: PostgresWorkforceAdapter;
  readonly socialPersistence: PostgresSocialPersistenceAdapter;
  readonly socialProtector: LocalSocialCredentialProtector;
  readonly socialAdapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly clock: ClockPort;
  readonly idGenerator: DefaultIdGenerator;
  readonly config: AppConfig;
  readonly authConfig: AuthConfig;
  readonly aiConfig: AIConfig;
  readonly socialConfig: SocialConfig;
}

export function createRouteProviders(ctx: RouteProvidersContext) {
  let resolvedAuthDeps: AuthDependencies | undefined;

  const authProvider = async (signal: AbortSignal): Promise<AuthDependencies> => {
    if (resolvedAuthDeps) return resolvedAuthDeps;
    if (!ctx.authConfig.enabled) {
      resolvedAuthDeps = { config: ctx.authConfig, appBaseUrl: ctx.config.appBaseUrl };
      return resolvedAuthDeps;
    }

    const oidcAdapter = await discoverOidcAdapter(
      {
        issuer: ctx.authConfig.issuer!,
        clientId: ctx.authConfig.clientId!,
        clientSecret: ctx.authConfig.clientSecret!,
        redirectUri: ctx.authConfig.redirectUri!,
      },
      { signal },
    );

    const cryptoAdapter = createAuthCryptoAdapter(
      ctx.authConfig.transactionEncryptionKeyBase64Url!,
      ctx.authConfig.transactionKeyVersion!,
    );

    resolvedAuthDeps = {
      config: ctx.authConfig,
      appBaseUrl: ctx.config.appBaseUrl,
      now: () => ctx.clock.now(),
      generateId: () => ctx.idGenerator.generateId(),
      oidcProtocolPort: oidcAdapter,
      loginTransactionStore: createPostgresLoginTransactionAdapter(ctx.database),
      sessionStore: createPostgresSessionAdapter(ctx.database),
      userDirectory: ctx.tenancyAdapter,
      identityResolution: {
        identityDirectory: ctx.tenancyAdapter,
        clock: ctx.clock,
        idGenerator: ctx.idGenerator,
      },
      workspaceSummary: createPostgresWorkspaceSummaryAdapter(ctx.database),
      crypto: cryptoAdapter,
    };
    return resolvedAuthDeps;
  };

  const workspaceProvider = async (signal: AbortSignal): Promise<WorkspaceRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      workspacePersistence: ctx.tenancyAdapter,
      workspaceAuthorization: ctx.tenancyAdapter,
      userDirectory: ctx.tenancyAdapter,
      clock: ctx.clock,
      idGenerator: ctx.idGenerator,
    };
  };

  const catalogProvider = async (signal: AbortSignal): Promise<CatalogRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      catalogPersistence: ctx.catalogAdapter,
      workspaceAuthorization: ctx.tenancyAdapter,
      clock: ctx.clock,
      idGenerator: ctx.idGenerator,
    };
  };

  const analysisProvider = async (signal: AbortSignal): Promise<AnalysisRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      workspaceAuthorization: ctx.tenancyAdapter,
      catalogPersistence: ctx.catalogAdapter,
      analysisPersistence: ctx.analysisAdapter,
      aiRunPersistence: ctx.analysisAdapter,
      operationPersistence: ctx.analysisAdapter,
      enqueueTxPort: ctx.analysisAdapter,
      persistTxPort: ctx.analysisAdapter,
      aiPolicyPort: ctx.analysisAdapter,
      aiModelConfig: ctx.aiConfig.enabled
        ? {
            provider: 'google',
            model: ctx.aiConfig.geminiModel,
            promptTemplate: 'product_analysis_v1',
            promptVersion: '1.0.0',
            inputSchemaVersion: 1,
            outputSchemaVersion: 1,
            estimatedCostMicrounits: ctx.aiConfig.estimatedCostMicrounits,
          }
        : undefined,
      clock: ctx.clock,
      idGenerator: ctx.idGenerator,
    };
  };

  const workforceProvider = async (signal: AbortSignal): Promise<WorkforceRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      workforcePersistence: ctx.workforceAdapter,
      workspaceAuthorization: ctx.tenancyAdapter,
      catalogPersistence: ctx.catalogAdapter,
      analysisPersistence: ctx.analysisAdapter,
      idGenerator: ctx.idGenerator,
      clock: ctx.clock,
    };
  };

  const socialProvider = async (signal: AbortSignal): Promise<SocialRouteDependencies> => {
    const authDeps = resolvedAuthDeps ?? (await authProvider(signal));
    return {
      auth: authDeps,
      socialConfig: ctx.socialConfig,
      socialPersistence: ctx.socialPersistence,
      credentialProtector: ctx.socialProtector,
      authAdapters: ctx.socialAdapters,
      workspaceAuthorization: ctx.tenancyAdapter,
      clock: ctx.clock,
      idGenerator: ctx.idGenerator,
    };
  };

  return {
    authProvider,
    workspaceProvider,
    catalogProvider,
    analysisProvider,
    workforceProvider,
    socialProvider,
  };
}
