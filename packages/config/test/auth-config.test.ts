import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  DEFAULT_AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
  DEFAULT_AUTH_SESSION_IDLE_TTL_SECONDS,
  DEFAULT_AUTH_SESSION_ROTATION_GRACE_SECONDS,
  DEFAULT_AUTH_SESSION_ROTATION_SECONDS,
  DEFAULT_AUTH_SESSION_TOUCH_INTERVAL_SECONDS,
  DEFAULT_AUTH_TRANSACTION_TTL_SECONDS,
  getRedactedAuthConfigMetadata,
  loadAuthConfig,
} from '../src/index.js';

describe('packages/config - loadAuthConfig', () => {
  // 32 random bytes canonical base64url (43 chars)
  const validKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const validDevIssuer = 'http://localhost:8080/realms/acos';
  const validProdIssuer = 'https://auth.example.com/oauth/v2';
  const validDevRedirect = 'http://localhost:3001/auth/callback';
  const validProdRedirect = 'https://api.example.com/auth/callback';

  const validDevAuthEnv = {
    NODE_ENV: 'development',
    AUTH_ENABLED: 'true',
    APP_BASE_URL: 'http://localhost:3000',
    OIDC_ISSUER: validDevIssuer,
    OIDC_CLIENT_ID: 'acos-api-client',
    OIDC_CLIENT_SECRET: 'super-secret-secret-value-1234',
    OIDC_REDIRECT_URI: validDevRedirect,
    AUTH_TRANSACTION_ENCRYPTION_KEY: validKey,
    AUTH_TRANSACTION_KEY_VERSION: 'k-2026-v1',
  };

  const validProdAuthEnv = {
    NODE_ENV: 'production',
    AUTH_ENABLED: 'true',
    APP_BASE_URL: 'https://app.example.com',
    OIDC_ISSUER: validProdIssuer,
    OIDC_CLIENT_ID: 'acos-prod-client',
    OIDC_CLIENT_SECRET: 'prod-secret-val-9999',
    OIDC_REDIRECT_URI: validProdRedirect,
    AUTH_TRANSACTION_ENCRYPTION_KEY: validKey,
    AUTH_TRANSACTION_KEY_VERSION: 'k-2026-v1',
  };

  it('rejects non-plain object or missing environment', () => {
    expect(() => loadAuthConfig(undefined)).toThrow(ConfigurationError);
    expect(() => loadAuthConfig(null)).toThrow(ConfigurationError);
    expect(() => loadAuthConfig('bad')).toThrow(ConfigurationError);
    expect(() => loadAuthConfig([1, 2, 3])).toThrow(ConfigurationError);
  });

  describe('disabled mode outside production', () => {
    it('defaults to disabled in development when AUTH_ENABLED is omitted', () => {
      const config = loadAuthConfig({ NODE_ENV: 'development' });
      expect(config.enabled).toBe(false);
      expect(config.issuer).toBeNull();
      expect(config.clientId).toBeNull();
      expect(config.clientSecret).toBeNull();
      expect(config.redirectUri).toBeNull();
      expect(config.transactionEncryptionKeyBase64Url).toBeNull();
      expect(config.transactionKeyVersion).toBeNull();
      expect(config.cookieSecure).toBe(false);
      expect(config.transactionTtlSeconds).toBe(DEFAULT_AUTH_TRANSACTION_TTL_SECONDS);
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('defaults to disabled in test when AUTH_ENABLED is omitted', () => {
      const config = loadAuthConfig({ NODE_ENV: 'test' });
      expect(config.enabled).toBe(false);
      expect(config.cookieSecure).toBe(false);
    });

    it('allows explicit AUTH_ENABLED=false outside production', () => {
      const config = loadAuthConfig({ NODE_ENV: 'development', AUTH_ENABLED: 'false' });
      expect(config.enabled).toBe(false);
    });

    it('rejects malformed AUTH_ENABLED values outside production', () => {
      for (const bad of ['True', 'FALSE', '1', '0', 'yes', 'no']) {
        expect(() => loadAuthConfig({ NODE_ENV: 'development', AUTH_ENABLED: bad })).toThrow(
          ConfigurationError,
        );
      }
    });

    it('forbids disabled auth in production mode', () => {
      expect(() => loadAuthConfig({ NODE_ENV: 'production' })).toThrow(ConfigurationError);
      expect(() => loadAuthConfig({ NODE_ENV: 'production', AUTH_ENABLED: 'false' })).toThrow(
        ConfigurationError,
      );
    });
  });

  describe('valid enabled configuration', () => {
    it('parses valid development configuration with default TTLs and derived cookieSecure=false', () => {
      const config = loadAuthConfig(validDevAuthEnv);
      expect(config.enabled).toBe(true);
      expect(config.issuer).toBe(validDevIssuer);
      expect(config.clientId).toBe('acos-api-client');
      expect(config.clientSecret).toBe('super-secret-secret-value-1234');
      expect(config.redirectUri).toBe(validDevRedirect);
      expect(config.transactionEncryptionKeyBase64Url).toBe(validKey);
      expect(config.transactionKeyVersion).toBe('k-2026-v1');
      expect(config.cookieSecure).toBe(false);
      expect(config.transactionTtlSeconds).toBe(DEFAULT_AUTH_TRANSACTION_TTL_SECONDS);
      expect(config.sessionIdleTtlSeconds).toBe(DEFAULT_AUTH_SESSION_IDLE_TTL_SECONDS);
      expect(config.sessionAbsoluteTtlSeconds).toBe(DEFAULT_AUTH_SESSION_ABSOLUTE_TTL_SECONDS);
      expect(config.sessionRotationSeconds).toBe(DEFAULT_AUTH_SESSION_ROTATION_SECONDS);
      expect(config.sessionRotationGraceSeconds).toBe(DEFAULT_AUTH_SESSION_ROTATION_GRACE_SECONDS);
      expect(config.sessionTouchIntervalSeconds).toBe(DEFAULT_AUTH_SESSION_TOUCH_INTERVAL_SECONDS);
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('parses valid production configuration with derived cookieSecure=true', () => {
      const config = loadAuthConfig(validProdAuthEnv);
      expect(config.enabled).toBe(true);
      expect(config.cookieSecure).toBe(true);
      expect(config.issuer).toBe(validProdIssuer);
      expect(config.redirectUri).toBe(validProdRedirect);
    });

    it('parses custom valid TTLs within allowed ranges and invariants', () => {
      const config = loadAuthConfig({
        ...validDevAuthEnv,
        AUTH_TRANSACTION_TTL_SECONDS: '300',
        AUTH_SESSION_IDLE_TTL_SECONDS: '1200',
        AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '14400',
        AUTH_SESSION_ROTATION_SECONDS: '600',
        AUTH_SESSION_ROTATION_GRACE_SECONDS: '45',
        AUTH_SESSION_TOUCH_INTERVAL_SECONDS: '120',
      });
      expect(config.transactionTtlSeconds).toBe(300);
      expect(config.sessionIdleTtlSeconds).toBe(1200);
      expect(config.sessionAbsoluteTtlSeconds).toBe(14400);
      expect(config.sessionRotationSeconds).toBe(600);
      expect(config.sessionRotationGraceSeconds).toBe(45);
      expect(config.sessionTouchIntervalSeconds).toBe(120);
    });
  });

  describe('URL validation rules', () => {
    it('requires APP_BASE_URL when auth is enabled', () => {
      const envWithoutBase = { ...validDevAuthEnv };
      delete (envWithoutBase as Record<string, unknown>)['APP_BASE_URL'];
      expect(() => loadAuthConfig(envWithoutBase)).toThrow(ConfigurationError);
    });

    it('rejects APP_BASE_URL with query or fragment', () => {
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, APP_BASE_URL: 'http://localhost:3000/?foo=bar' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, APP_BASE_URL: 'http://localhost:3000/#fragment' }),
      ).toThrow(ConfigurationError);
    });

    it('rejects HTTP APP_BASE_URL in production', () => {
      expect(() =>
        loadAuthConfig({ ...validProdAuthEnv, APP_BASE_URL: 'http://app.example.com' }),
      ).toThrow(ConfigurationError);
    });

    it('rejects HTTP OIDC_ISSUER in production mode', () => {
      expect(() =>
        loadAuthConfig({ ...validProdAuthEnv, OIDC_ISSUER: 'http://auth.example.com' }),
      ).toThrow(ConfigurationError);
    });

    it('rejects HTTP OIDC_ISSUER outside loopback in development mode', () => {
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, OIDC_ISSUER: 'http://external-auth.example.com' }),
      ).toThrow(ConfigurationError);
    });

    it('rejects OIDC_ISSUER with query or fragment', () => {
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, OIDC_ISSUER: `${validDevIssuer}?query=1` }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, OIDC_ISSUER: `${validDevIssuer}#frag` }),
      ).toThrow(ConfigurationError);
    });

    it('rejects OIDC_REDIRECT_URI if pathname is not /auth/callback', () => {
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, OIDC_REDIRECT_URI: 'http://localhost:3001/callback' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, OIDC_REDIRECT_URI: 'http://localhost:3001/' }),
      ).toThrow(ConfigurationError);
    });

    it('rejects HTTP OIDC_REDIRECT_URI in production mode', () => {
      expect(() =>
        loadAuthConfig({
          ...validProdAuthEnv,
          OIDC_REDIRECT_URI: 'http://api.example.com/auth/callback',
        }),
      ).toThrow(ConfigurationError);
    });
  });

  describe('key and version validation', () => {
    it('rejects non-base64url characters in AUTH_TRANSACTION_ENCRYPTION_KEY', () => {
      const badKey = validKey.slice(0, 42) + '+';
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_TRANSACTION_ENCRYPTION_KEY: badKey }),
      ).toThrow(ConfigurationError);
    });

    it('rejects padded base64url AUTH_TRANSACTION_ENCRYPTION_KEY', () => {
      const paddedKey = validKey.slice(0, 42) + '=';
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_TRANSACTION_ENCRYPTION_KEY: paddedKey }),
      ).toThrow(ConfigurationError);
    });

    it('rejects wrong-length AUTH_TRANSACTION_ENCRYPTION_KEY', () => {
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_TRANSACTION_ENCRYPTION_KEY: 'AAAA' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({
          ...validDevAuthEnv,
          AUTH_TRANSACTION_ENCRYPTION_KEY: `${validKey}A`,
        }),
      ).toThrow(ConfigurationError);
    });

    it('rejects invalid AUTH_TRANSACTION_KEY_VERSION', () => {
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_TRANSACTION_KEY_VERSION: '' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_TRANSACTION_KEY_VERSION: 'has space' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_TRANSACTION_KEY_VERSION: 'x'.repeat(65) }),
      ).toThrow(ConfigurationError);
    });
  });

  describe('client ID and secret validation', () => {
    it('rejects whitespace in client ID and client secret', () => {
      expect(() => loadAuthConfig({ ...validDevAuthEnv, OIDC_CLIENT_ID: ' client ' })).toThrow(
        ConfigurationError,
      );
      expect(() => loadAuthConfig({ ...validDevAuthEnv, OIDC_CLIENT_SECRET: ' secret ' })).toThrow(
        ConfigurationError,
      );
    });

    it('rejects empty client ID or client secret', () => {
      expect(() => loadAuthConfig({ ...validDevAuthEnv, OIDC_CLIENT_ID: '' })).toThrow(
        ConfigurationError,
      );
      expect(() => loadAuthConfig({ ...validDevAuthEnv, OIDC_CLIENT_SECRET: '' })).toThrow(
        ConfigurationError,
      );
    });
  });

  describe('TTL boundaries and relationship invariants', () => {
    it('rejects out of range TTLs', () => {
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_TRANSACTION_TTL_SECONDS: '100' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_TRANSACTION_TTL_SECONDS: '1000' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_SESSION_IDLE_TTL_SECONDS: '200' }),
      ).toThrow(ConfigurationError);
      expect(() =>
        loadAuthConfig({ ...validDevAuthEnv, AUTH_SESSION_IDLE_TTL_SECONDS: '4000' }),
      ).toThrow(ConfigurationError);
    });

    it('rejects absolute TTL <= idle TTL', () => {
      expect(() =>
        loadAuthConfig({
          ...validDevAuthEnv,
          AUTH_SESSION_IDLE_TTL_SECONDS: '3600',
          AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '3600',
        }),
      ).toThrow(ConfigurationError);
    });

    it('rejects rotation >= idle TTL', () => {
      expect(() =>
        loadAuthConfig({
          ...validDevAuthEnv,
          AUTH_SESSION_IDLE_TTL_SECONDS: '600',
          AUTH_SESSION_ROTATION_SECONDS: '600',
        }),
      ).toThrow(ConfigurationError);
    });

    it('rejects grace >= rotation interval', () => {
      expect(() =>
        loadAuthConfig({
          ...validDevAuthEnv,
          AUTH_SESSION_ROTATION_SECONDS: '300',
          AUTH_SESSION_ROTATION_GRACE_SECONDS: '300',
        }),
      ).toThrow(ConfigurationError);
    });

    it('rejects touch interval >= idle TTL', () => {
      expect(() =>
        loadAuthConfig({
          ...validDevAuthEnv,
          AUTH_SESSION_IDLE_TTL_SECONDS: '300',
          AUTH_SESSION_TOUCH_INTERVAL_SECONDS: '300',
        }),
      ).toThrow(ConfigurationError);
    });
  });

  describe('redacted metadata helper', () => {
    it('never exposes secrets, tokens, or derived hashes', () => {
      const config = loadAuthConfig(validProdAuthEnv);
      const redacted = getRedactedAuthConfigMetadata(config);

      expect(redacted.enabled).toBe(true);
      expect(redacted.hasIssuer).toBe(true);
      expect(redacted.hasClientId).toBe(true);
      expect(redacted.hasClientSecret).toBe(true);
      expect(redacted.hasRedirectUri).toBe(true);
      expect(redacted.hasTransactionEncryptionKey).toBe(true);
      expect(redacted.transactionKeyVersion).toBe('k-2026-v1');
      expect(redacted.cookieSecure).toBe(true);
      expect(redacted.transactionTtlSeconds).toBe(config.transactionTtlSeconds);

      // Verify non-disclosure: secret strings must not be present
      const serialized = JSON.stringify(redacted);
      expect(serialized).not.toContain('super-secret');
      expect(serialized).not.toContain('prod-secret');
      expect(serialized).not.toContain(validKey);
      expect(serialized).not.toContain(validProdIssuer);
      expect(serialized).not.toContain(validProdRedirect);
      expect(Object.isFrozen(redacted)).toBe(true);
    });
  });
});
