import * as client from 'openid-client';

export type OidcDiagnosticCategory =
  | 'oauth_invalid_grant'
  | 'oauth_invalid_client'
  | 'oauth_temporarily_unavailable'
  | 'protocol_issuer_invalid'
  | 'protocol_nonce_invalid'
  | 'protocol_token_claim_invalid'
  | 'protocol_timestamp_invalid'
  | 'network_failure'
  | 'timeout'
  | 'unknown_safe';

export type OidcDiagnosticOutcome = 'invalid' | 'unavailable' | 'configuration_unavailable';

export interface SafeDiagnosticEntry {
  readonly category: OidcDiagnosticCategory;
  readonly status?: number | undefined;
  readonly error?: string | undefined;
}

export type DiagnosticLogger = (entry: SafeDiagnosticEntry) => void;

const ALLOWED_OAUTH_ERRORS = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
]);

const KNOWN_CLAIM_CODES = new Set([
  'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
  'OAUTH_JWT_CLAIM_COMPARISON',
]);

const KNOWN_TIMESTAMP_CODES = new Set([
  'OAUTH_JWT_TIMESTAMP_CHECK_FAILED',
  'OAUTH_JWT_TIMESTAMP_CHECK',
]);

const KNOWN_ATTR_CODES = new Set([
  'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED',
  'OAUTH_JSON_ATTRIBUTE_COMPARISON',
]);

function inspectClaimHint(err: unknown): 'iss' | 'nonce' | 'other' {
  try {
    const rawCause = (err as { cause?: unknown })?.cause;
    if (typeof rawCause === 'object' && rawCause !== null) {
      const nested = (rawCause as { cause?: unknown }).cause;
      const target = typeof nested === 'object' && nested !== null ? nested : rawCause;
      const claim = (target as { claim?: unknown }).claim;
      if (claim === 'iss') return 'iss';
      if (claim === 'nonce') return 'nonce';
      const attr = (target as { attribute?: unknown }).attribute;
      if (attr === 'issuer' || attr === 'iss') return 'iss';
    }
    const msg =
      typeof (err as { message?: unknown })?.message === 'string'
        ? (err as { message: string }).message
        : '';
    if (/\b(iss|issuer)\b/i.test(msg)) return 'iss';
    if (/\bnonce\b/i.test(msg)) return 'nonce';
  } catch {
    // Avoid any hostile getter exceptions
  }
  return 'other';
}

export function classifyResponseBodyError(err: client.ResponseBodyError): SafeDiagnosticEntry {
  let safeStatus: number | undefined;
  if (
    typeof err.status === 'number' &&
    Number.isInteger(err.status) &&
    err.status >= 100 &&
    err.status <= 599
  ) {
    safeStatus = err.status;
  }

  let safeError: string | undefined;
  if (typeof err.error === 'string' && ALLOWED_OAUTH_ERRORS.has(err.error)) {
    safeError = err.error;
  }

  let category: OidcDiagnosticCategory = 'unknown_safe';
  if (safeError === 'invalid_grant') {
    category = 'oauth_invalid_grant';
  } else if (safeError === 'invalid_client') {
    category = 'oauth_invalid_client';
  } else if (
    safeError === 'temporarily_unavailable' ||
    safeError === 'server_error' ||
    (safeStatus !== undefined && safeStatus >= 500)
  ) {
    category = 'oauth_temporarily_unavailable';
  }

  return Object.freeze({
    category,
    ...(safeStatus !== undefined ? { status: safeStatus } : {}),
    ...(safeError !== undefined ? { error: safeError } : {}),
  });
}

export function classifyClientError(err: client.ClientError): SafeDiagnosticEntry {
  const code = typeof err.code === 'string' ? err.code : '';

  if (code === 'OAUTH_TIMEOUT' || code === 'OAUTH_ABORT') {
    return Object.freeze({ category: 'timeout' });
  }

  if (KNOWN_TIMESTAMP_CODES.has(code)) {
    return Object.freeze({ category: 'protocol_timestamp_invalid' });
  }

  if (KNOWN_CLAIM_CODES.has(code)) {
    const hint = inspectClaimHint(err);
    if (hint === 'iss') return Object.freeze({ category: 'protocol_issuer_invalid' });
    if (hint === 'nonce') return Object.freeze({ category: 'protocol_nonce_invalid' });
    return Object.freeze({ category: 'protocol_token_claim_invalid' });
  }

  if (KNOWN_ATTR_CODES.has(code)) {
    const hint = inspectClaimHint(err);
    if (hint === 'iss') return Object.freeze({ category: 'protocol_issuer_invalid' });
    return Object.freeze({ category: 'protocol_token_claim_invalid' });
  }

  if (code === 'OAUTH_INVALID_RESPONSE') {
    const hint = inspectClaimHint(err);
    if (hint === 'iss') return Object.freeze({ category: 'protocol_issuer_invalid' });
    if (hint === 'nonce') return Object.freeze({ category: 'protocol_nonce_invalid' });
    return Object.freeze({ category: 'protocol_token_claim_invalid' });
  }

  if (
    code === 'OAUTH_PARSE_ERROR' ||
    code === 'OAUTH_DECRYPTION_FAILED' ||
    code === 'OAUTH_KEY_SELECTION_FAILED'
  ) {
    return Object.freeze({ category: 'protocol_token_claim_invalid' });
  }

  if (code === 'OAUTH_RESPONSE_IS_NOT_CONFORM' || code === 'OAUTH_RESPONSE_IS_NOT_JSON') {
    return Object.freeze({ category: 'oauth_temporarily_unavailable' });
  }

  return Object.freeze({ category: 'unknown_safe' });
}

export function classifyGrantError(err: unknown): SafeDiagnosticEntry {
  if (err instanceof client.ResponseBodyError) {
    return classifyResponseBodyError(err);
  }
  if (err instanceof client.ClientError) {
    return classifyClientError(err);
  }
  if (err instanceof TypeError) {
    return Object.freeze({ category: 'network_failure' });
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return Object.freeze({ category: 'timeout' });
    }
  }
  return Object.freeze({ category: 'unknown_safe' });
}

export function mapDiagnosticOutcome(category: OidcDiagnosticCategory): OidcDiagnosticOutcome {
  switch (category) {
    case 'oauth_invalid_grant':
    case 'protocol_issuer_invalid':
    case 'protocol_nonce_invalid':
    case 'protocol_token_claim_invalid':
    case 'protocol_timestamp_invalid':
      return 'invalid';
    case 'oauth_invalid_client':
      return 'configuration_unavailable';
    case 'oauth_temporarily_unavailable':
    case 'network_failure':
    case 'timeout':
    case 'unknown_safe':
      return 'unavailable';
  }
}

export const defaultDiagnosticLogger: DiagnosticLogger = (entry: SafeDiagnosticEntry) => {
  const parts = [`category=${entry.category}`];
  if (entry.status !== undefined) parts.push(`status=${entry.status}`);
  if (entry.error !== undefined) parts.push(`error=${entry.error}`);
  console.warn(`[oidc-grant-diagnostic] ${parts.join(' ')}`);
};
