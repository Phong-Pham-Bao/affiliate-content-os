import { ConfigurationError, type ConfigurationIssue } from './errors.js';
import {
  ALLOWED_SOCIAL_KEY_PROVIDERS,
  DEFAULT_SOCIAL_CALLBACK_RESULT_TTL_SECONDS,
  DEFAULT_SOCIAL_TRANSACTION_TTL_SECONDS,
  type NodeEnv,
  type RawEnvironment,
  type SocialConfig,
  type SocialKeyProvider,
} from './types.js';
import { validateThreadsConfig } from './validate-threads.js';

function parseBoundedInteger(
  value: string | undefined,
  field: string,
  min: number,
  max: number,
  defaultValue: number,
  issues: ConfigurationIssue[],
): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    issues.push({
      field,
      message: `Must be a safe integer between ${min} and ${max}`,
    });
    return defaultValue;
  }
  return parsed;
}

function validateSocialEncryptionKey(
  value: unknown,
  issues: ConfigurationIssue[],
): string | undefined {
  const field = 'SOCIAL_CREDENTIAL_ENCRYPTION_KEY';
  if (typeof value !== 'string' || value.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    issues.push({
      field,
      message: 'Must be canonical unpadded base64url encoding of exactly 32 bytes',
    });
    return undefined;
  }
  const buf = Buffer.from(value, 'base64url');
  if (buf.length !== 32 || buf.toString('base64url') !== value) {
    issues.push({
      field,
      message: 'Must be canonical unpadded base64url encoding of exactly 32 bytes',
    });
    return undefined;
  }
  return value;
}

export function loadSocialConfig(rawEnv: RawEnvironment, nodeEnv?: NodeEnv): SocialConfig {
  const issues: ConfigurationIssue[] = [];

  const rawEnabled = rawEnv['SOCIAL_AUTH_ENABLED'];
  let enabled = false;
  if (rawEnabled !== undefined && rawEnabled.trim() !== '') {
    const trimmed = rawEnabled.trim().toLowerCase();
    if (trimmed === 'true') {
      enabled = true;
    } else if (trimmed === 'false') {
      enabled = false;
    } else {
      issues.push({
        field: 'SOCIAL_AUTH_ENABLED',
        message: 'Must be either "true" or "false"',
      });
    }
  }

  const rawFake = rawEnv['SOCIAL_FAKE_ADAPTER_ENABLED'];
  let fakeAdapterEnabled = false;
  if (rawFake !== undefined && rawFake.trim() !== '') {
    const trimmed = rawFake.trim().toLowerCase();
    if (trimmed === 'true') {
      fakeAdapterEnabled = true;
    } else if (trimmed === 'false') {
      fakeAdapterEnabled = false;
    } else {
      issues.push({
        field: 'SOCIAL_FAKE_ADAPTER_ENABLED',
        message: 'Must be either "true" or "false"',
      });
    }
  }

  const rawKeyProvider = rawEnv['SOCIAL_KEY_PROVIDER']?.trim();
  let keyProvider: SocialKeyProvider = 'local';
  if (rawKeyProvider !== undefined && rawKeyProvider !== '') {
    if ((ALLOWED_SOCIAL_KEY_PROVIDERS as readonly string[]).includes(rawKeyProvider)) {
      keyProvider = rawKeyProvider as SocialKeyProvider;
    } else {
      issues.push({
        field: 'SOCIAL_KEY_PROVIDER',
        message: 'Must be one of: local, kms',
      });
    }
  }

  // Production fail-closed validation
  if (nodeEnv === 'production') {
    if (fakeAdapterEnabled) {
      issues.push({
        field: 'SOCIAL_FAKE_ADAPTER_ENABLED',
        message: 'Fake social adapter cannot be enabled in production',
      });
    }
    if (enabled) {
      if (keyProvider === 'kms') {
        issues.push({
          field: 'SOCIAL_KEY_PROVIDER',
          message: 'Managed KMS key provider is not implemented in Checkpoint A',
        });
      } else {
        issues.push({
          field: 'SOCIAL_KEY_PROVIDER',
          message:
            'Local credential encryption key cannot be used in production. A production-approved KMS key provider is required',
        });
      }
    }
  }

  let credentialEncryptionKeyBase64Url: string | null = null;
  let credentialKeyVersion: string | null = null;

  if (enabled && keyProvider === 'local') {
    const validatedKey = validateSocialEncryptionKey(
      rawEnv['SOCIAL_CREDENTIAL_ENCRYPTION_KEY'],
      issues,
    );
    if (validatedKey) {
      credentialEncryptionKeyBase64Url = validatedKey;
    }

    const rawVersion = rawEnv['SOCIAL_CREDENTIAL_KEY_VERSION'];
    if (typeof rawVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(rawVersion)) {
      issues.push({
        field: 'SOCIAL_CREDENTIAL_KEY_VERSION',
        message: 'SOCIAL_CREDENTIAL_KEY_VERSION is required and must match ^[A-Za-z0-9._-]{1,64}$',
      });
    } else {
      credentialKeyVersion = rawVersion;
    }
  }

  const transactionTtlSeconds = parseBoundedInteger(
    rawEnv['SOCIAL_TRANSACTION_TTL_SECONDS'],
    'SOCIAL_TRANSACTION_TTL_SECONDS',
    60,
    3600,
    DEFAULT_SOCIAL_TRANSACTION_TTL_SECONDS,
    issues,
  );

  const callbackResultTtlSeconds = parseBoundedInteger(
    rawEnv['SOCIAL_CALLBACK_RESULT_TTL_SECONDS'],
    'SOCIAL_CALLBACK_RESULT_TTL_SECONDS',
    30,
    3600,
    DEFAULT_SOCIAL_CALLBACK_RESULT_TTL_SECONDS,
    issues,
  );

  const threadsConfig = validateThreadsConfig(rawEnv, nodeEnv, enabled, issues);

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  return Object.freeze({
    enabled,
    fakeAdapterEnabled,
    keyProvider,
    credentialEncryptionKeyBase64Url,
    credentialKeyVersion,
    transactionTtlSeconds,
    callbackResultTtlSeconds,
    ...threadsConfig,
  });
}
