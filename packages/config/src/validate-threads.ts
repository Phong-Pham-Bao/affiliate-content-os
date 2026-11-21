import type { ConfigurationIssue } from './errors.js';
import {
  ALLOWED_THREADS_APP_REVIEW_STATUSES,
  DEFAULT_META_GRAPH_BASE_URL,
  DEFAULT_META_GRAPH_VERSION,
  DEFAULT_THREADS_API_BASE_URL,
  DEFAULT_THREADS_API_VERSION,
  DEFAULT_THREADS_AUTH_BASE_URL,
  DEFAULT_THREADS_HTTP_TIMEOUT_MS,
  type NodeEnv,
  type RawEnvironment,
  type ThreadsAppReviewStatus,
} from './types.js';
import {
  validateThreadsCredentials,
  type ThreadsCredentials,
} from './validate-threads-credentials.js';

export interface ValidatedThreadsConfig {
  readonly threadsRealAdapterEnabled: boolean;
  readonly threadsAppId: string | null;
  readonly threadsAppSecret: string | null;
  readonly threadsRedirectUri: string | null;
  readonly threadsAuthBaseUrl: string;
  readonly threadsApiBaseUrl: string;
  readonly threadsApiVersion: string;
  readonly metaGraphBaseUrl: string;
  readonly metaGraphVersion: string;
  readonly threadsAppAccessToken: string | null;
  readonly threadsAppReviewStatus: ThreadsAppReviewStatus;
  readonly threadsHttpTimeoutMs: number;
  readonly socialKillSwitchActive: boolean;
  readonly threadsConnectionKillSwitchActive: boolean;
  readonly threadsRefreshKillSwitchActive: boolean;
  readonly threadsPublishKillSwitchActive: boolean;
}

function parseBoolean(
  value: string | undefined,
  field: string,
  defaultValue: boolean,
  issues: ConfigurationIssue[],
): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  const lower = value.trim().toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  issues.push({ field, message: 'Must be either "true" or "false"' });
  return defaultValue;
}

function validateProviderUrl(
  urlStr: string | undefined,
  field: string,
  defaultUrl: string,
  expectedHost: string,
  nodeEnv: NodeEnv | undefined,
  issues: ConfigurationIssue[],
): string {
  if (urlStr === undefined || urlStr.trim() === '') return defaultUrl;
  const trimmed = urlStr.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      issues.push({ field, message: 'Must not include credentials in URL' });
    }
    if (parsed.search || parsed.hash) {
      issues.push({ field, message: 'Must not include query or fragment in base URL' });
    }
    if (parsed.pathname !== '' && parsed.pathname !== '/') {
      issues.push({ field, message: 'Must not include path prefix in base URL' });
    }
    if (nodeEnv === 'production') {
      if (parsed.protocol !== 'https:') {
        issues.push({ field, message: 'Must use https protocol in production' });
      }
      if (parsed.hostname !== expectedHost) {
        issues.push({ field, message: `Must use allowlisted host ${expectedHost} in production` });
      }
      if (parsed.port && parsed.port !== '443') {
        issues.push({ field, message: 'Must not specify custom port in production' });
      }
    } else if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      issues.push({ field, message: 'Must use http or https protocol' });
    }
    return trimmed.replace(/\/+$/, '');
  } catch {
    issues.push({ field, message: 'Must be a valid parseable URL' });
    return defaultUrl;
  }
}

export function validateThreadsConfig(
  rawEnv: RawEnvironment,
  nodeEnv: NodeEnv | undefined,
  socialEnabled: boolean,
  issues: ConfigurationIssue[],
): ValidatedThreadsConfig {
  const threadsRealAdapterEnabled = parseBoolean(
    rawEnv['THREADS_REAL_ADAPTER_ENABLED'],
    'THREADS_REAL_ADAPTER_ENABLED',
    false,
    issues,
  );
  const socialKillSwitchActive = parseBoolean(
    rawEnv['SOCIAL_KILL_SWITCH_ACTIVE'],
    'SOCIAL_KILL_SWITCH_ACTIVE',
    false,
    issues,
  );
  const threadsConnectionKillSwitchActive = parseBoolean(
    rawEnv['THREADS_CONNECTION_KILL_SWITCH_ACTIVE'],
    'THREADS_CONNECTION_KILL_SWITCH_ACTIVE',
    false,
    issues,
  );
  const threadsRefreshKillSwitchActive = parseBoolean(
    rawEnv['THREADS_REFRESH_KILL_SWITCH_ACTIVE'],
    'THREADS_REFRESH_KILL_SWITCH_ACTIVE',
    false,
    issues,
  );
  const threadsPublishKillSwitchActive = parseBoolean(
    rawEnv['THREADS_PUBLISH_KILL_SWITCH_ACTIVE'],
    'THREADS_PUBLISH_KILL_SWITCH_ACTIVE',
    false,
    issues,
  );

  let threadsAppReviewStatus: ThreadsAppReviewStatus = 'development';
  const rawReview = rawEnv['THREADS_APP_REVIEW_STATUS']?.trim();
  if (rawReview !== undefined && rawReview !== '') {
    if ((ALLOWED_THREADS_APP_REVIEW_STATUSES as readonly string[]).includes(rawReview)) {
      threadsAppReviewStatus = rawReview as ThreadsAppReviewStatus;
    } else {
      issues.push({
        field: 'THREADS_APP_REVIEW_STATUS',
        message: 'Must be one of: development, approved',
      });
    }
  }

  let threadsHttpTimeoutMs = DEFAULT_THREADS_HTTP_TIMEOUT_MS;
  const rawTimeout = rawEnv['THREADS_HTTP_TIMEOUT_MS'];
  if (rawTimeout !== undefined && rawTimeout.trim() !== '') {
    const parsed = Number(rawTimeout.trim());
    if (!Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 60000) {
      issues.push({
        field: 'THREADS_HTTP_TIMEOUT_MS',
        message: 'Must be a safe integer between 1000 and 60000',
      });
    } else {
      threadsHttpTimeoutMs = parsed;
    }
  }

  const threadsAuthBaseUrl = validateProviderUrl(
    rawEnv['THREADS_AUTH_BASE_URL'],
    'THREADS_AUTH_BASE_URL',
    DEFAULT_THREADS_AUTH_BASE_URL,
    'www.threads.com',
    nodeEnv,
    issues,
  );

  const threadsApiBaseUrl = validateProviderUrl(
    rawEnv['THREADS_API_BASE_URL'],
    'THREADS_API_BASE_URL',
    DEFAULT_THREADS_API_BASE_URL,
    'graph.threads.com',
    nodeEnv,
    issues,
  );

  let threadsApiVersion = DEFAULT_THREADS_API_VERSION;
  const rawApiVer = rawEnv['THREADS_API_VERSION']?.trim();
  if (rawApiVer !== undefined && rawApiVer !== '') {
    if (!/^v[0-9]+\.[0-9]+$/.test(rawApiVer)) {
      issues.push({ field: 'THREADS_API_VERSION', message: 'Must match format vX.Y (e.g. v1.0)' });
    } else {
      threadsApiVersion = rawApiVer;
    }
  }

  const metaGraphBaseUrl = validateProviderUrl(
    rawEnv['META_GRAPH_BASE_URL'],
    'META_GRAPH_BASE_URL',
    DEFAULT_META_GRAPH_BASE_URL,
    'graph.facebook.com',
    nodeEnv,
    issues,
  );

  let metaGraphVersion = DEFAULT_META_GRAPH_VERSION;
  const rawMetaVer = rawEnv['META_GRAPH_VERSION']?.trim();
  if (rawMetaVer !== undefined && rawMetaVer !== '') {
    if (!/^v[0-9]+\.[0-9]+$/.test(rawMetaVer)) {
      issues.push({ field: 'META_GRAPH_VERSION', message: 'Must match format vX.Y (e.g. v21.0)' });
    } else {
      metaGraphVersion = rawMetaVer;
    }
  }

  let threadsAppAccessToken: string | null = null;
  const rawAppToken = rawEnv['THREADS_APP_ACCESS_TOKEN']?.trim();
  if (rawAppToken !== undefined && rawAppToken !== '') {
    // eslint-disable-next-line no-control-regex
    if (rawAppToken.length > 512 || /[\x00-\x1F\x7F]/.test(rawAppToken)) {
      issues.push({
        field: 'THREADS_APP_ACCESS_TOKEN',
        message: 'Must be a valid token string (<= 512 chars, no control chars)',
      });
    } else {
      threadsAppAccessToken = rawAppToken;
    }
  }

  let creds: ThreadsCredentials = {
    threadsAppId: null,
    threadsAppSecret: null,
    threadsRedirectUri: null,
  };
  if (socialEnabled && threadsRealAdapterEnabled) {
    creds = validateThreadsCredentials(rawEnv, nodeEnv, issues);
  }

  return {
    threadsRealAdapterEnabled,
    threadsAppId: creds.threadsAppId,
    threadsAppSecret: creds.threadsAppSecret,
    threadsRedirectUri: creds.threadsRedirectUri,
    threadsAuthBaseUrl,
    threadsApiBaseUrl,
    threadsApiVersion,
    metaGraphBaseUrl,
    metaGraphVersion,
    threadsAppAccessToken,
    threadsAppReviewStatus,
    threadsHttpTimeoutMs,
    socialKillSwitchActive,
    threadsConnectionKillSwitchActive,
    threadsRefreshKillSwitchActive,
    threadsPublishKillSwitchActive,
  };
}
