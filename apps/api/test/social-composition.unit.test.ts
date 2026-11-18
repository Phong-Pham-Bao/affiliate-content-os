import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig, loadSocialConfig } from '@affiliate-content-os/config';
import {
  FakeSocialAuthAdapter,
  LocalSocialCredentialProtector,
} from '@affiliate-content-os/infrastructure/social';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import type { SocialAuthAdapter } from '@affiliate-content-os/application';

describe('API Process Social Composition Root (TASK-016 Remediation 02)', () => {
  const validKey = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';

  it('rejects unsupported production social configuration using exact main.ts invocation sequence', () => {
    const rawEnv = {
      NODE_ENV: 'production',
      SOCIAL_AUTH_ENABLED: 'true',
      SOCIAL_KEY_PROVIDER: 'local',
      SOCIAL_CREDENTIAL_ENCRYPTION_KEY: validKey,
      SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
    };

    const config = loadConfig(rawEnv);
    expect(config.nodeEnv).toBe('production');

    expect(() => loadSocialConfig(rawEnv, config.nodeEnv)).toThrow(ConfigurationError);
  });

  it('rejects fake adapter in production using exact main.ts invocation sequence', () => {
    const rawEnv = {
      NODE_ENV: 'production',
      SOCIAL_AUTH_ENABLED: 'false',
      SOCIAL_FAKE_ADAPTER_ENABLED: 'true',
    };

    const config = loadConfig(rawEnv);
    expect(() => loadSocialConfig(rawEnv, config.nodeEnv)).toThrow(ConfigurationError);
  });

  it('rejects unimplemented KMS in production using exact main.ts invocation sequence', () => {
    const rawEnv = {
      NODE_ENV: 'production',
      SOCIAL_AUTH_ENABLED: 'true',
      SOCIAL_KEY_PROVIDER: 'kms',
    };

    const config = loadConfig(rawEnv);
    expect(() => loadSocialConfig(rawEnv, config.nodeEnv)).toThrow(ConfigurationError);
  });

  it('permits production startup when social auth is disabled and wires no protector or fake adapters', () => {
    const rawEnv = {
      NODE_ENV: 'production',
      SOCIAL_AUTH_ENABLED: 'false',
    };

    const config = loadConfig(rawEnv);
    const socialConfig = loadSocialConfig(rawEnv, config.nodeEnv);

    expect(socialConfig.enabled).toBe(false);

    // Exact composition wiring from main.ts
    const socialProtector =
      socialConfig.enabled && socialConfig.credentialEncryptionKeyBase64Url
        ? new LocalSocialCredentialProtector(
            socialConfig.credentialEncryptionKeyBase64Url,
            socialConfig.credentialKeyVersion ?? 'v1',
          )
        : undefined;

    const socialAdapters = new Map<SocialPlatform, SocialAuthAdapter>();
    if (
      socialConfig.enabled &&
      socialConfig.fakeAdapterEnabled &&
      config.nodeEnv !== 'production'
    ) {
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

    expect(socialProtector).toBeUndefined();
    expect(socialAdapters.size).toBe(0);
  });

  it('wires real local protector and fake adapters in non-production environment', () => {
    const rawEnv = {
      NODE_ENV: 'development',
      SOCIAL_AUTH_ENABLED: 'true',
      SOCIAL_FAKE_ADAPTER_ENABLED: 'true',
      SOCIAL_KEY_PROVIDER: 'local',
      SOCIAL_CREDENTIAL_ENCRYPTION_KEY: validKey,
      SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
    };

    const config = loadConfig(rawEnv);
    const socialConfig = loadSocialConfig(rawEnv, config.nodeEnv);

    expect(socialConfig.enabled).toBe(true);
    expect(socialConfig.fakeAdapterEnabled).toBe(true);

    // Exact composition wiring from main.ts
    const socialProtector =
      socialConfig.enabled && socialConfig.credentialEncryptionKeyBase64Url
        ? new LocalSocialCredentialProtector(
            socialConfig.credentialEncryptionKeyBase64Url,
            socialConfig.credentialKeyVersion ?? 'v1',
          )
        : undefined;

    const socialAdapters = new Map<SocialPlatform, SocialAuthAdapter>();
    if (
      socialConfig.enabled &&
      socialConfig.fakeAdapterEnabled &&
      config.nodeEnv !== 'production'
    ) {
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

    expect(socialProtector).toBeInstanceOf(LocalSocialCredentialProtector);
    expect(socialAdapters.size).toBe(2);
    expect(socialAdapters.get('threads')).toBeDefined();
    expect(socialAdapters.get('tiktok')).toBeDefined();
  });
});
