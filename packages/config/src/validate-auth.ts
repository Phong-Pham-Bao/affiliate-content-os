import { ConfigurationError, type ConfigurationIssue } from './errors.js';
import { ALLOWED_NODE_ENVS, type AuthConfig, type NodeEnv } from './types.js';
import {
  validateUrl,
  validateEncryptionKey,
  validateAuthTtls,
} from './validate-auth-primitives.js';

interface EnabledAuthFields {
  issuer: string | null;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  encryptionKey: string | null;
  keyVersion: string | null;
}

function validateEnabledAuthFields(
  env: Record<string, unknown>,
  nodeEnv: NodeEnv,
  issues: ConfigurationIssue[],
): EnabledAuthFields {
  let issuer: string | null = null;
  let clientId: string | null = null;
  let clientSecret: string | null = null;
  let redirectUri: string | null = null;
  let encryptionKey: string | null = null;
  let keyVersion: string | null = null;

  const rawAppBaseUrl = env['APP_BASE_URL'];
  if (rawAppBaseUrl === undefined || rawAppBaseUrl === '') {
    issues.push({
      field: 'APP_BASE_URL',
      message: 'APP_BASE_URL is required when authentication is enabled',
    });
  } else {
    validateUrl('APP_BASE_URL', rawAppBaseUrl, nodeEnv, issues);
  }

  const validatedIssuer = validateUrl('OIDC_ISSUER', env['OIDC_ISSUER'], nodeEnv, issues);
  if (validatedIssuer) issuer = validatedIssuer;

  const rawClientId = env['OIDC_CLIENT_ID'];
  if (
    typeof rawClientId !== 'string' ||
    rawClientId.trim() === '' ||
    rawClientId !== rawClientId.trim()
  ) {
    issues.push({
      field: 'OIDC_CLIENT_ID',
      message: 'OIDC_CLIENT_ID is required and must not have surrounding whitespace',
    });
  } else {
    clientId = rawClientId;
  }

  const rawClientSecret = env['OIDC_CLIENT_SECRET'];
  if (
    typeof rawClientSecret !== 'string' ||
    rawClientSecret.trim() === '' ||
    rawClientSecret !== rawClientSecret.trim()
  ) {
    issues.push({
      field: 'OIDC_CLIENT_SECRET',
      message: 'OIDC_CLIENT_SECRET is required and must not have surrounding whitespace',
    });
  } else {
    clientSecret = rawClientSecret;
  }

  const validatedRedirect = validateUrl(
    'OIDC_REDIRECT_URI',
    env['OIDC_REDIRECT_URI'],
    nodeEnv,
    issues,
    (p) => p === '/auth/callback',
  );
  if (validatedRedirect) redirectUri = validatedRedirect;

  const validatedKey = validateEncryptionKey(env['AUTH_TRANSACTION_ENCRYPTION_KEY'], issues);
  if (validatedKey) encryptionKey = validatedKey;

  const rawVersion = env['AUTH_TRANSACTION_KEY_VERSION'];
  if (typeof rawVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(rawVersion)) {
    issues.push({
      field: 'AUTH_TRANSACTION_KEY_VERSION',
      message: 'AUTH_TRANSACTION_KEY_VERSION is required and must match ^[A-Za-z0-9._-]{1,64}$',
    });
  } else {
    keyVersion = rawVersion;
  }

  return { issuer, clientId, clientSecret, redirectUri, encryptionKey, keyVersion };
}

function resolveAuthEnabled(
  env: Record<string, unknown>,
  nodeEnv: NodeEnv,
  issues: ConfigurationIssue[],
): boolean {
  const rawAuthEnabled = env['AUTH_ENABLED'];
  if (nodeEnv === 'production') {
    if (rawAuthEnabled !== 'true') {
      issues.push({
        field: 'AUTH_ENABLED',
        message: 'Authentication cannot be disabled in production',
      });
      return false;
    }
    return true;
  }
  if (rawAuthEnabled !== undefined) {
    if (rawAuthEnabled === 'true') {
      return true;
    }
    if (rawAuthEnabled === 'false') {
      return false;
    }
    issues.push({
      field: 'AUTH_ENABLED',
      message: 'Must be exact lowercase string: true or false',
    });
  }
  return false;
}

export function loadAuthConfig(rawEnv?: unknown): AuthConfig {
  if (
    rawEnv === undefined ||
    rawEnv === null ||
    typeof rawEnv !== 'object' ||
    Array.isArray(rawEnv)
  ) {
    throw new ConfigurationError([
      { field: 'environment', message: 'Environment must be a plain object record' },
    ]);
  }
  const env = rawEnv as Record<string, unknown>;
  const issues: ConfigurationIssue[] = [];

  const rawNodeEnv = env['NODE_ENV'];
  const nodeEnv: NodeEnv =
    typeof rawNodeEnv === 'string' && (ALLOWED_NODE_ENVS as readonly string[]).includes(rawNodeEnv)
      ? (rawNodeEnv as NodeEnv)
      : 'development';

  const enabled = resolveAuthEnabled(env, nodeEnv, issues);
  const ttls = validateAuthTtls(env, issues);

  let fields: EnabledAuthFields = {
    issuer: null,
    clientId: null,
    clientSecret: null,
    redirectUri: null,
    encryptionKey: null,
    keyVersion: null,
  };
  if (enabled) {
    fields = validateEnabledAuthFields(env, nodeEnv, issues);
  }

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  return Object.freeze({
    enabled,
    issuer: fields.issuer,
    clientId: fields.clientId,
    clientSecret: fields.clientSecret,
    redirectUri: fields.redirectUri,
    transactionEncryptionKeyBase64Url: fields.encryptionKey,
    transactionKeyVersion: fields.keyVersion,
    transactionTtlSeconds: ttls.txTtl,
    sessionIdleTtlSeconds: ttls.idleTtl,
    sessionAbsoluteTtlSeconds: ttls.absTtl,
    sessionRotationSeconds: ttls.rotTtl,
    sessionRotationGraceSeconds: ttls.graceTtl,
    sessionTouchIntervalSeconds: ttls.touchTtl,
    cookieSecure: nodeEnv === 'production',
  });
}
