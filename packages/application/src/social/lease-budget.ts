import { SocialAuthOutcomeUnknownError } from './errors.js';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;
export const DEFAULT_REVOCATION_TIMEOUT_MS = 10000;
export const LOCAL_PROCESSING_MARGIN_MS = 30000;
export const MAX_REFRESH_PROVIDER_CALLS = 4;
export const MAX_REVOCATION_PROVIDER_CALLS = 1;

/**
 * Calculates a unified worst-case lease budget for social account refresh sequences.
 * Covers up to 4 sequential provider requests:
 * 1. POST /oauth/access_token (refresh token exchange)
 * 2. GET /me (profile identity inspection)
 * 3. GET /oauth/access_token (client_credentials app token, if not pre-injected)
 * 4. GET /debug_token (Meta debug token inspection)
 * Plus local crypto, database, and process margin.
 */
export function calculateRefreshLeaseDurationSeconds(providerTimeoutMs?: number): number {
  const timeout = providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const boundedTimeout = Math.max(1000, timeout);
  const totalMs = MAX_REFRESH_PROVIDER_CALLS * boundedTimeout + LOCAL_PROCESSING_MARGIN_MS;
  return Math.max(120, Math.ceil(totalMs / 1000));
}

/**
 * Calculates a unified worst-case lease budget for social account revocation sequences.
 * Covers 1 provider revocation request plus margin.
 */
export function calculateRevocationLeaseDurationSeconds(providerTimeoutMs?: number): number {
  const timeout = providerTimeoutMs ?? DEFAULT_REVOCATION_TIMEOUT_MS;
  const boundedTimeout = Math.max(1000, timeout);
  const totalMs = MAX_REVOCATION_PROVIDER_CALLS * boundedTimeout + LOCAL_PROCESSING_MARGIN_MS;
  return Math.max(60, Math.ceil(totalMs / 1000));
}

/**
 * Wraps a promise with an application-level timeout. If the promise does not settle
 * within timeoutMs, rejects with SocialAuthOutcomeUnknownError.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Provider request timed out before outcome could be established safely.',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SocialAuthOutcomeUnknownError(errorMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
