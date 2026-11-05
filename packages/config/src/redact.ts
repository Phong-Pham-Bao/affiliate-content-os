import type {
  AppConfig,
  AuthConfig,
  DatabaseConfig,
  RedactedAuthConfigMetadata,
  RedactedConfigMetadata,
  RedactedDatabaseMetadata,
} from './types.js';

/**
 * Returns redacted configuration metadata suitable for startup diagnostics and logging.
 * Never leaks raw environment values, credentials, URL paths, queries, or fragments.
 */
export function getRedactedConfigMetadata(config: AppConfig): RedactedConfigMetadata {
  let appBaseUrlOrigin: string | undefined;

  if (config.appBaseUrl) {
    try {
      const parsed = new URL(config.appBaseUrl);
      appBaseUrlOrigin = parsed.origin;
    } catch {
      // Should not occur on validated config, but safe fallback
      appBaseUrlOrigin = undefined;
    }
  }

  const result: RedactedConfigMetadata = {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    hasAppBaseUrl: Boolean(config.appBaseUrl),
    ...(appBaseUrlOrigin ? { appBaseUrlOrigin } : {}),
    apiHost: config.apiHost,
    apiPort: config.apiPort,
  };

  return Object.freeze(result);
}

/**
 * Returns redacted database configuration metadata for startup diagnostics.
 * Never serializes database URL, credentials, origin, or sensitive paths.
 */
export function getRedactedDatabaseMetadata(config: DatabaseConfig): RedactedDatabaseMetadata {
  const result: RedactedDatabaseMetadata = {
    hasDatabaseUrl: Boolean(config.databaseUrl),
    poolMax: config.poolMax,
    connectionTimeoutMs: config.connectionTimeoutMs,
    idleTimeoutMs: config.idleTimeoutMs,
    statementTimeoutMs: config.statementTimeoutMs,
    sslMode: config.sslMode,
    hasSslCaFile: Boolean(config.sslCaFile),
  };

  return Object.freeze(result);
}

/**
 * Returns redacted authentication configuration metadata for startup diagnostics.
 * Never exposes issuer, client ID, client secret, redirect URI, encryption key,
 * decoded bytes, cookies, or derived hashes.
 */
export function getRedactedAuthConfigMetadata(config: AuthConfig): RedactedAuthConfigMetadata {
  const result: RedactedAuthConfigMetadata = {
    enabled: config.enabled,
    hasIssuer: Boolean(config.issuer),
    hasClientId: Boolean(config.clientId),
    hasClientSecret: Boolean(config.clientSecret),
    hasRedirectUri: Boolean(config.redirectUri),
    hasTransactionEncryptionKey: Boolean(config.transactionEncryptionKeyBase64Url),
    transactionKeyVersion: config.transactionKeyVersion,
    transactionTtlSeconds: config.transactionTtlSeconds,
    sessionIdleTtlSeconds: config.sessionIdleTtlSeconds,
    sessionAbsoluteTtlSeconds: config.sessionAbsoluteTtlSeconds,
    sessionRotationSeconds: config.sessionRotationSeconds,
    sessionRotationGraceSeconds: config.sessionRotationGraceSeconds,
    sessionTouchIntervalSeconds: config.sessionTouchIntervalSeconds,
    cookieSecure: config.cookieSecure,
  };

  return Object.freeze(result);
}
