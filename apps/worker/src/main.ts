import {
  loadAIConfig,
  loadConfig,
  loadDatabaseConfig,
  loadSocialConfig,
  readAndValidateSslCaFile,
  type AIConfig,
  type AppConfig,
  type DatabaseConfig,
  type SocialConfig,
} from '@affiliate-content-os/config';
import { createDatabase } from '@affiliate-content-os/infrastructure/database';
import {
  FakeSocialAuthAdapter,
  LocalSocialCredentialProtector,
  PostgresSocialPersistenceAdapter,
  ThreadsSocialAuthAdapter,
} from '@affiliate-content-os/infrastructure/social';
import type {
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from '@affiliate-content-os/application';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import { startWorker } from './runner.js';

async function main(): Promise<void> {
  let config: AppConfig;
  let aiConfig: AIConfig | undefined;
  let socialConfig: SocialConfig | undefined;
  let databaseConfig: DatabaseConfig;
  let sslCaContent: string | undefined;

  try {
    config = loadConfig(process.env);
    aiConfig = loadAIConfig(process.env);
    databaseConfig = loadDatabaseConfig(process.env);
    if (databaseConfig.sslMode === 'verify-full' && databaseConfig.sslCaFile) {
      sslCaContent = readAndValidateSslCaFile(databaseConfig.sslCaFile);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown configuration error';
    console.error(`Worker process startup failed: ${message}`);
    process.exit(1);
  }

  try {
    socialConfig = loadSocialConfig(process.env, config.nodeEnv);
  } catch (err: unknown) {
    const rawSocialAuth = process.env['SOCIAL_AUTH_ENABLED']?.trim().toLowerCase();
    const rawMaintenance = process.env['SOCIAL_MAINTENANCE_ENABLED']?.trim().toLowerCase();
    const isExplicitlyDisabled =
      (rawSocialAuth === 'false' || rawSocialAuth === undefined || rawSocialAuth === '') &&
      (rawMaintenance === 'false' || rawMaintenance === undefined || rawMaintenance === '');

    if (!isExplicitlyDisabled) {
      const message = err instanceof Error ? err.message : 'Unknown social configuration error';
      console.error(`Worker process startup failed: ${message}`);
      process.exit(1);
    }
  }

  const database = createDatabase(databaseConfig, { sslCaContent });

  let socialPersistence: SocialPersistencePort | undefined;
  let credentialProtector: SocialCredentialProtectorPort | undefined;
  const socialAdapters = new Map<SocialPlatform, SocialAuthAdapter>();

  if (socialConfig?.enabled) {
    socialPersistence = new PostgresSocialPersistenceAdapter(database);
    if (socialConfig.credentialEncryptionKeyBase64Url) {
      credentialProtector = new LocalSocialCredentialProtector(
        socialConfig.credentialEncryptionKeyBase64Url,
        socialConfig.credentialKeyVersion ?? 'v1',
      );
    }
    if (socialConfig.fakeAdapterEnabled) {
      socialAdapters.set(
        'threads',
        new FakeSocialAuthAdapter({
          platform: 'threads',
          authBaseUrl: socialConfig.threadsAuthBaseUrl,
        }),
      );
    } else if (
      socialConfig.threadsRealAdapterEnabled &&
      socialConfig.threadsAppId &&
      socialConfig.threadsAppSecret
    ) {
      socialAdapters.set(
        'threads',
        new ThreadsSocialAuthAdapter({
          appId: socialConfig.threadsAppId,
          appSecret: socialConfig.threadsAppSecret,
          authBaseUrl: socialConfig.threadsAuthBaseUrl,
          apiBaseUrl: socialConfig.threadsApiBaseUrl,
          apiVersion: socialConfig.threadsApiVersion,
          metaGraphBaseUrl: socialConfig.metaGraphBaseUrl,
          metaGraphVersion: socialConfig.metaGraphVersion,
          appAccessToken: socialConfig.threadsAppAccessToken ?? undefined,
          timeoutMs: socialConfig.threadsHttpTimeoutMs,
          environment: config.nodeEnv === 'production' ? 'production' : 'local',
        }),
      );
    }
  }

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
    await startWorker({
      config,
      aiConfig,
      socialConfig,
      socialPersistence,
      credentialProtector,
      socialAdapters,
      socialMaintenanceEnabled: socialConfig?.socialMaintenanceEnabled,
      database,
    });
    console.log('Worker process stopped gracefully');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Worker process startup failed: ${message}`);
    process.exit(1);
  }
}

void main();
