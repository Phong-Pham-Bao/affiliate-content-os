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
});
