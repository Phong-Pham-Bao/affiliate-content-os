import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  getRedactedSocialConfigMetadata,
  loadSocialConfig,
} from '../src/index.js';

describe('validate-social configuration', () => {
  const validKey = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE';

  it('loads default disabled config when no social env vars are provided', () => {
    const config = loadSocialConfig({});
    expect(config.enabled).toBe(false);
    expect(config.fakeAdapterEnabled).toBe(false);
    expect(config.keyProvider).toBe('local');
    expect(config.credentialEncryptionKeyBase64Url).toBeNull();
    expect(config.credentialKeyVersion).toBeNull();
    expect(config.transactionTtlSeconds).toBe(600);
    expect(config.callbackResultTtlSeconds).toBe(300);
  });

  it('loads valid enabled config in development', () => {
    const config = loadSocialConfig(
      {
        SOCIAL_AUTH_ENABLED: 'true',
        SOCIAL_FAKE_ADAPTER_ENABLED: 'true',
        SOCIAL_KEY_PROVIDER: 'local',
        SOCIAL_CREDENTIAL_ENCRYPTION_KEY: validKey,
        SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
        SOCIAL_TRANSACTION_TTL_SECONDS: '900',
        SOCIAL_CALLBACK_RESULT_TTL_SECONDS: '450',
      },
      'development',
    );
    expect(config.enabled).toBe(true);
    expect(config.fakeAdapterEnabled).toBe(true);
    expect(config.keyProvider).toBe('local');
    expect(config.credentialEncryptionKeyBase64Url).toBe(validKey);
    expect(config.credentialKeyVersion).toBe('v1');
    expect(config.transactionTtlSeconds).toBe(900);
    expect(config.callbackResultTtlSeconds).toBe(450);
  });

  it('fails closed in production if fake adapter is enabled', () => {
    expect(() =>
      loadSocialConfig(
        {
          SOCIAL_AUTH_ENABLED: 'true',
          SOCIAL_FAKE_ADAPTER_ENABLED: 'true',
          SOCIAL_KEY_PROVIDER: 'kms',
        },
        'production',
      ),
    ).toThrow(ConfigurationError);
  });

  it('fails closed in production if local key provider is configured', () => {
    expect(() =>
      loadSocialConfig(
        {
          SOCIAL_AUTH_ENABLED: 'true',
          SOCIAL_KEY_PROVIDER: 'local',
          SOCIAL_CREDENTIAL_ENCRYPTION_KEY: validKey,
          SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
        },
        'production',
      ),
    ).toThrow(ConfigurationError);
  });

  it('fails closed in production if KMS is configured (not implemented in Checkpoint A)', () => {
    try {
      loadSocialConfig(
        {
          SOCIAL_AUTH_ENABLED: 'true',
          SOCIAL_KEY_PROVIDER: 'kms',
        },
        'production',
      );
      expect.unreachable('Should have thrown ConfigurationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const confErr = err as ConfigurationError;
      expect(
        confErr.issues.some((i) =>
          i.message.includes('Managed KMS key provider is not implemented'),
        ),
      ).toBe(true);
    }
  });

  it('permits production startup when social auth is disabled', () => {
    const config = loadSocialConfig({ SOCIAL_AUTH_ENABLED: 'false' }, 'production');
    expect(config.enabled).toBe(false);
  });

  it('rejects invalid encryption key (wrong length or padded base64)', () => {
    expect(() =>
      loadSocialConfig({
        SOCIAL_AUTH_ENABLED: 'true',
        SOCIAL_KEY_PROVIDER: 'local',
        SOCIAL_CREDENTIAL_ENCRYPTION_KEY: 'too-short',
        SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects invalid key version', () => {
    expect(() =>
      loadSocialConfig({
        SOCIAL_AUTH_ENABLED: 'true',
        SOCIAL_KEY_PROVIDER: 'local',
        SOCIAL_CREDENTIAL_ENCRYPTION_KEY: validKey,
        SOCIAL_CREDENTIAL_KEY_VERSION: 'invalid version with spaces!',
      }),
    ).toThrow(ConfigurationError);
  });

  it('redacts social configuration metadata without leaking secrets', () => {
    const config = loadSocialConfig(
      {
        SOCIAL_AUTH_ENABLED: 'true',
        SOCIAL_FAKE_ADAPTER_ENABLED: 'true',
        SOCIAL_KEY_PROVIDER: 'local',
        SOCIAL_CREDENTIAL_ENCRYPTION_KEY: validKey,
        SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
      },
      'development',
    );

    const redacted = getRedactedSocialConfigMetadata(config);
    expect(redacted.enabled).toBe(true);
    expect(redacted.fakeAdapterEnabled).toBe(true);
    expect(redacted.hasCredentialEncryptionKey).toBe(true);
    expect(redacted.credentialKeyVersion).toBe('v1');
    expect(
      (redacted as unknown as Record<string, unknown>)['credentialEncryptionKeyBase64Url'],
    ).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain(validKey);
  });

  it('validates Threads real adapter configuration when enabled', () => {
    const config = loadSocialConfig(
      {
        SOCIAL_AUTH_ENABLED: 'true',
        SOCIAL_KEY_PROVIDER: 'local',
        SOCIAL_CREDENTIAL_ENCRYPTION_KEY: validKey,
        SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
        THREADS_REAL_ADAPTER_ENABLED: 'true',
        THREADS_APP_ID: '1234567890',
        THREADS_APP_SECRET: 'threads_secret_abc123',
        THREADS_REDIRECT_URI: 'https://example.com/api/v1/social-connections/threads/callback',
        THREADS_APP_REVIEW_STATUS: 'approved',
      },
      'development',
    );

    expect(config.threadsRealAdapterEnabled).toBe(true);
    expect(config.threadsAppId).toBe('1234567890');
    expect(config.threadsAppSecret).toBe('threads_secret_abc123');
    expect(config.threadsRedirectUri).toBe(
      'https://example.com/api/v1/social-connections/threads/callback',
    );
    expect(config.threadsAppReviewStatus).toBe('approved');
    expect(config.threadsAuthBaseUrl).toBe('https://threads.net');
    expect(config.threadsApiBaseUrl).toBe('https://graph.threads.net');

    const redacted = getRedactedSocialConfigMetadata(config);
    expect(redacted.threadsRealAdapterEnabled).toBe(true);
    expect(redacted.hasThreadsAppId).toBe(true);
    expect(redacted.hasThreadsAppSecret).toBe(true);
    expect(redacted.threadsAppReviewStatus).toBe('approved');
    expect(JSON.stringify(redacted)).not.toContain('threads_secret_abc123');
  });

  it('rejects Threads real adapter if app secret or id is missing', () => {
    expect(() =>
      loadSocialConfig(
        {
          SOCIAL_AUTH_ENABLED: 'true',
          SOCIAL_KEY_PROVIDER: 'local',
          SOCIAL_CREDENTIAL_ENCRYPTION_KEY: validKey,
          SOCIAL_CREDENTIAL_KEY_VERSION: 'v1',
          THREADS_REAL_ADAPTER_ENABLED: 'true',
        },
        'development',
      ),
    ).toThrow(ConfigurationError);
  });

  it('rejects unapproved host for Threads in production', () => {
    expect(() =>
      loadSocialConfig(
        {
          SOCIAL_AUTH_ENABLED: 'false',
          THREADS_API_BASE_URL: 'https://attacker.example.com',
        },
        'production',
      ),
    ).toThrow(ConfigurationError);
  });

  it('rejects credentials in Threads provider URL', () => {
    expect(() =>
      loadSocialConfig({
        THREADS_AUTH_BASE_URL: 'https://user:pass@threads.net',
      }),
    ).toThrow(ConfigurationError);
  });

  it('loads kill switch flags correctly', () => {
    const config = loadSocialConfig({
      SOCIAL_KILL_SWITCH_ACTIVE: 'true',
      THREADS_CONNECTION_KILL_SWITCH_ACTIVE: 'true',
      THREADS_REFRESH_KILL_SWITCH_ACTIVE: 'true',
    });
    expect(config.socialKillSwitchActive).toBe(true);
    expect(config.threadsConnectionKillSwitchActive).toBe(true);
    expect(config.threadsRefreshKillSwitchActive).toBe(true);
  });
});
