import { ConfigurationError, type ConfigurationIssue } from './errors.js';

export const DEFAULT_DEV_WEB_API_BASE_URL = 'http://127.0.0.1:3001';
export const UNREACHABLE_PRODUCTION_WEB_API_BASE_URL = 'http://127.0.0.1:0';

/**
 * Resolves and narrowly validates the server-only WEB_API_BASE_URL.
 * - Accepts only http or https origin URLs.
 * - Rejects credentials, paths, query strings, and hash fragments.
 * - Strictly rejects exposure as NEXT_PUBLIC_WEB_API_BASE_URL.
 * - Defaults to http://127.0.0.1:3001 in development and test.
 * - In production mode with missing value, returns a deliberate unreachable target
 *   (http://127.0.0.1:0) to fail closed at runtime without silently routing to localhost.
 * - Throws ConfigurationError for invalid explicit values.
 */
export function resolveWebApiBaseUrl(rawEnv?: unknown): string {
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

  const env = rawEnv as Record<string, unknown>;
  const issues: ConfigurationIssue[] = [];

  if (env['NEXT_PUBLIC_WEB_API_BASE_URL'] !== undefined) {
    issues.push({
      field: 'NEXT_PUBLIC_WEB_API_BASE_URL',
      message: 'WEB_API_BASE_URL must never be exposed as NEXT_PUBLIC',
    });
  }

  const rawVal = env['WEB_API_BASE_URL'];
  const nodeEnv = env['NODE_ENV'];

  if (rawVal === undefined || rawVal === '') {
    if (issues.length > 0) {
      throw new ConfigurationError(issues);
    }
    if (nodeEnv === 'production') {
      return UNREACHABLE_PRODUCTION_WEB_API_BASE_URL;
    }
    return DEFAULT_DEV_WEB_API_BASE_URL;
  }

  if (typeof rawVal !== 'string' || rawVal.trim() === '' || rawVal !== rawVal.trim()) {
    issues.push({
      field: 'WEB_API_BASE_URL',
      message: 'Must be a valid absolute HTTP or HTTPS origin URL without whitespace',
    });
    throw new ConfigurationError(issues);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawVal);
  } catch {
    issues.push({
      field: 'WEB_API_BASE_URL',
      message: 'Must be a valid absolute HTTP or HTTPS URL',
    });
    throw new ConfigurationError(issues);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    issues.push({
      field: 'WEB_API_BASE_URL',
      message: 'Must use http or https protocol',
    });
  }

  if (parsed.username !== '' || parsed.password !== '') {
    issues.push({
      field: 'WEB_API_BASE_URL',
      message: 'Must not contain embedded credentials',
    });
  }

  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    issues.push({
      field: 'WEB_API_BASE_URL',
      message: 'Must be an origin URL without path',
    });
  }

  if (parsed.search !== '') {
    issues.push({
      field: 'WEB_API_BASE_URL',
      message: 'Must not contain query parameters',
    });
  }

  if (parsed.hash !== '') {
    issues.push({
      field: 'WEB_API_BASE_URL',
      message: 'Must not contain a fragment identifier',
    });
  }

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  return parsed.origin;
}
