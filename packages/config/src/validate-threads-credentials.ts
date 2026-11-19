import type { ConfigurationIssue } from './errors.js';
import type { NodeEnv, RawEnvironment } from './types.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

export interface ThreadsCredentials {
  readonly threadsAppId: string | null;
  readonly threadsAppSecret: string | null;
  readonly threadsRedirectUri: string | null;
}

export function validateThreadsCredentials(
  rawEnv: RawEnvironment,
  nodeEnv: NodeEnv | undefined,
  issues: ConfigurationIssue[],
): ThreadsCredentials {
  let threadsAppId: string | null = null;
  let threadsAppSecret: string | null = null;
  let threadsRedirectUri: string | null = null;

  const rawAppId = rawEnv['THREADS_APP_ID'];
  if (
    typeof rawAppId !== 'string' ||
    rawAppId.trim().length === 0 ||
    rawAppId.trim().length > 64 ||
    CONTROL_CHARS_REGEX.test(rawAppId)
  ) {
    issues.push({
      field: 'THREADS_APP_ID',
      message: 'THREADS_APP_ID is required when real adapter is enabled (1-64 chars)',
    });
  } else {
    threadsAppId = rawAppId.trim();
  }

  const rawSecret = rawEnv['THREADS_APP_SECRET'];
  if (
    typeof rawSecret !== 'string' ||
    rawSecret.trim().length === 0 ||
    rawSecret.trim().length > 128 ||
    CONTROL_CHARS_REGEX.test(rawSecret)
  ) {
    issues.push({
      field: 'THREADS_APP_SECRET',
      message: 'THREADS_APP_SECRET is required when real adapter is enabled (1-128 chars)',
    });
  } else {
    threadsAppSecret = rawSecret.trim();
  }

  const rawRedirect = rawEnv['THREADS_REDIRECT_URI'];
  if (
    typeof rawRedirect !== 'string' ||
    rawRedirect.trim().length === 0 ||
    rawRedirect.trim().length > 2048 ||
    CONTROL_CHARS_REGEX.test(rawRedirect)
  ) {
    issues.push({
      field: 'THREADS_REDIRECT_URI',
      message: 'THREADS_REDIRECT_URI is required when real adapter is enabled (<= 2048 chars)',
    });
  } else {
    try {
      const parsed = new URL(rawRedirect.trim());
      if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
        issues.push({
          field: 'THREADS_REDIRECT_URI',
          message: 'THREADS_REDIRECT_URI must use https in production',
        });
      }
      threadsRedirectUri = rawRedirect.trim();
    } catch {
      issues.push({
        field: 'THREADS_REDIRECT_URI',
        message: 'THREADS_REDIRECT_URI must be a valid parseable URL',
      });
    }
  }

  return { threadsAppId, threadsAppSecret, threadsRedirectUri };
}
