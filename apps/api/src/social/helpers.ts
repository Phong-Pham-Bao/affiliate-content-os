import type { FastifyRequest } from 'fastify';
import {
  OAuthCallbackInvalidError,
  type SocialAuditContext,
} from '@affiliate-content-os/application';
import { AuthOriginInvalidError, validateOrigin } from '../auth/origin.js';
import { MAX_CALLBACK_QUERY_LENGTH } from './constants.js';
import type { SocialRouteDependencies } from './types.js';

export function validateSocialMutationOrigin(
  request: FastifyRequest,
  deps: SocialRouteDependencies,
): void {
  const originHeader = request.headers['origin'];
  if (typeof originHeader !== 'string' || originHeader === 'null' || originHeader.trim() === '') {
    throw new AuthOriginInvalidError();
  }
  const appBaseUrl = deps.auth.appBaseUrl ?? 'http://127.0.0.1:3000';
  const redirectUri = deps.auth.config.redirectUri ?? appBaseUrl;
  validateOrigin(originHeader, appBaseUrl, redirectUri);
}

export function extractSocialAuditContext(request: FastifyRequest): SocialAuditContext {
  const rawReqId = request.headers['x-request-id'];
  const correlationId = typeof rawReqId === 'string' && rawReqId.length <= 128 ? rawReqId : null;
  const rawUserAgent =
    typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent'].slice(0, 128)
      : null;

  return {
    ipHash: null,
    userAgentSummary: rawUserAgent,
    correlationId,
  };
}

export interface ValidatedCallbackQuery {
  readonly state: string;
  readonly code?: string | undefined;
  readonly error?: string | undefined;
  readonly errorDescription?: string | undefined;
}

export function validateCallbackQueryParams(request: FastifyRequest): ValidatedCallbackQuery {
  const rawUrl = request.raw.url ?? '';
  const queryIndex = rawUrl.indexOf('?');
  const queryString = queryIndex >= 0 ? rawUrl.slice(queryIndex + 1) : '';

  if (queryString.length > MAX_CALLBACK_QUERY_LENGTH) {
    throw new OAuthCallbackInvalidError('Query string exceeds maximum allowed length');
  }

  // Check for HTTP Parameter Pollution (duplicate query keys)
  const keyCounts = new Map<string, number>();
  const searchParams = new URLSearchParams(queryString);

  for (const key of searchParams.keys()) {
    const count = (keyCounts.get(key) ?? 0) + 1;
    if (count > 1) {
      throw new OAuthCallbackInvalidError(`Duplicate query parameter detected: ${key}`);
    }
    keyCounts.set(key, count);
  }

  const state = searchParams.get('state');
  if (!state || state.trim() === '') {
    throw new OAuthCallbackInvalidError('Missing required "state" parameter');
  }

  const code = searchParams.get('code') ?? undefined;
  const error = searchParams.get('error') ?? undefined;
  const errorDescription = searchParams.get('error_description') ?? undefined;

  return {
    state,
    code,
    error,
    errorDescription,
  };
}
