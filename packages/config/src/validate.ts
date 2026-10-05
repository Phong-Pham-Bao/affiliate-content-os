import { ConfigurationError, type ConfigurationIssue } from './errors.js';
import {
  ALLOWED_LOG_LEVELS,
  ALLOWED_NODE_ENVS,
  DEFAULT_LOG_LEVEL,
  type AppConfig,
  type LogLevel,
  type NodeEnv,
} from './types.js';

function validateNodeEnv(
  rawEnv: Record<string, unknown>,
  issues: ConfigurationIssue[],
): NodeEnv | undefined {
  const value = rawEnv['NODE_ENV'];

  if (value === undefined || value === '' || (typeof value === 'string' && value.trim() === '')) {
    issues.push({
      field: 'NODE_ENV',
      message: 'NODE_ENV is required and must be development, test, or production',
    });
    return undefined;
  }

  if (typeof value !== 'string' || !(ALLOWED_NODE_ENVS as readonly string[]).includes(value)) {
    issues.push({
      field: 'NODE_ENV',
      message: 'Must be one of: development, test, production',
    });
    return undefined;
  }

  return value as NodeEnv;
}

function validateLogLevel(rawEnv: Record<string, unknown>, issues: ConfigurationIssue[]): LogLevel {
  const value = rawEnv['LOG_LEVEL'];

  if (value === undefined) {
    return DEFAULT_LOG_LEVEL;
  }

  if (typeof value !== 'string' || !(ALLOWED_LOG_LEVELS as readonly string[]).includes(value)) {
    issues.push({
      field: 'LOG_LEVEL',
      message: 'Must be one of: trace, debug, info, warn, error, fatal',
    });
    return DEFAULT_LOG_LEVEL;
  }

  return value as LogLevel;
}

function validateAppBaseUrl(
  rawEnv: Record<string, unknown>,
  nodeEnv: NodeEnv | undefined,
  issues: ConfigurationIssue[],
): string | undefined {
  const value = rawEnv['APP_BASE_URL'];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    issues.push({
      field: 'APP_BASE_URL',
      message: 'Must be a valid absolute HTTP or HTTPS URL',
    });
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issues.push({
      field: 'APP_BASE_URL',
      message: 'Must be a valid absolute HTTP or HTTPS URL',
    });
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    issues.push({
      field: 'APP_BASE_URL',
      message: 'Must use http or https protocol',
    });
    return undefined;
  }

  if (parsed.username !== '' || parsed.password !== '') {
    issues.push({
      field: 'APP_BASE_URL',
      message: 'Must not contain embedded credentials',
    });
    return undefined;
  }

  if (parsed.search !== '') {
    issues.push({
      field: 'APP_BASE_URL',
      message: 'Must not contain query parameters',
    });
    return undefined;
  }

  if (parsed.hash !== '') {
    issues.push({
      field: 'APP_BASE_URL',
      message: 'Must not contain a fragment identifier',
    });
    return undefined;
  }

  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    issues.push({
      field: 'APP_BASE_URL',
      message: 'Must use https protocol in production',
    });
    return undefined;
  }

  return value;
}

/**
 * Loads and validates configuration from an injected plain environment record.
 * Never reads process.env directly at import time.
 * Rejects missing, null, array, and non-record input without leaking supplied values.
 */
export function loadConfig(rawEnv?: unknown): AppConfig {
  if (
    rawEnv === undefined ||
    rawEnv === null ||
    typeof rawEnv !== 'object' ||
    Array.isArray(rawEnv)
  ) {
    throw new ConfigurationError([
      {
        field: 'environment',
        message: 'Environment must be a plain object record',
      },
    ]);
  }

  const envRecord = rawEnv as Record<string, unknown>;
  const issues: ConfigurationIssue[] = [];

  const nodeEnv = validateNodeEnv(envRecord, issues);
  const logLevel = validateLogLevel(envRecord, issues);
  const appBaseUrl = validateAppBaseUrl(envRecord, nodeEnv, issues);

  if (issues.length > 0 || !nodeEnv) {
    throw new ConfigurationError(issues);
  }

  const config: AppConfig = {
    nodeEnv,
    logLevel,
    ...(appBaseUrl ? { appBaseUrl } : {}),
  };

  return Object.freeze(config);
}
