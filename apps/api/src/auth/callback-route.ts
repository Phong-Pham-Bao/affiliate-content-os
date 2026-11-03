import type { FastifyPluginAsync } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  OidcCallbackInvalidError,
  completeOidcLogin,
  validateReturnTo,
} from '@affiliate-content-os/application';
import {
  COOKIE_TRANSACTION,
  RATE_LIMIT_CALLBACK_MAX,
  RATE_LIMIT_CALLBACK_WINDOW_MS,
} from './constants.js';
import { clearTransactionCookie, setSessionCookie } from './cookies.js';
import { callbackRouteSchema } from './schemas.js';
import type { AuthDependencies } from './types.js';

function parseAndValidateRawCallback(rawUrlStr: string): Record<string, string> {
  if (typeof rawUrlStr !== 'string' || rawUrlStr.includes('#')) {
    throw new OidcCallbackInvalidError();
  }

  const qIdx = rawUrlStr.indexOf('?');
  if (qIdx === -1) {
    throw new OidcCallbackInvalidError();
  }

  const rawQuery = rawUrlStr.slice(qIdx + 1);
  if (rawQuery.includes('?')) {
    throw new OidcCallbackInvalidError();
  }
  if (rawQuery.startsWith('&') || rawQuery.endsWith('&') || rawQuery.includes('&&')) {
    throw new OidcCallbackInvalidError();
  }

  for (let i = 0; i < rawQuery.length; i++) {
    if (rawQuery[i] === '%') {
      if (i + 2 >= rawQuery.length) {
        throw new OidcCallbackInvalidError();
      }
      const hex = rawQuery.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new OidcCallbackInvalidError();
      }
    }
  }

  const pairs = rawQuery.split('&');
  if (pairs.length === 0) {
    throw new OidcCallbackInvalidError();
  }

  const seenDecodedKeys = new Set<string>();
  const seenRawKeys = new Set<string>();
  const parsedRecord: Record<string, string> = Object.create(null);

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);

    let decodedKey: string;
    let decodedVal: string;
    try {
      decodedKey = decodeURIComponent(rawKey);
      decodedVal = decodeURIComponent(rawVal);
    } catch {
      throw new OidcCallbackInvalidError();
    }

    if (
      decodedKey !== 'code' &&
      decodedKey !== 'state' &&
      decodedKey !== 'error' &&
      decodedKey !== 'error_description' &&
      decodedKey !== 'error_uri'
    ) {
      throw new OidcCallbackInvalidError();
    }

    if (seenRawKeys.has(rawKey) || seenDecodedKeys.has(decodedKey)) {
      throw new OidcCallbackInvalidError();
    }
    seenRawKeys.add(rawKey);
    seenDecodedKeys.add(decodedKey);

    for (let i = 0; i < decodedKey.length; i++) {
      const code = decodedKey.charCodeAt(i);
      if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
        throw new OidcCallbackInvalidError();
      }
    }
    for (let i = 0; i < decodedVal.length; i++) {
      const code = decodedVal.charCodeAt(i);
      if (code === 0) {
        throw new OidcCallbackInvalidError();
      }
    }

    parsedRecord[decodedKey] = decodedVal;
  }

  if (!parsedRecord['state'] || (!parsedRecord['code'] && !parsedRecord['error'])) {
    throw new OidcCallbackInvalidError();
  }

  return parsedRecord;
}

export function createCallbackRoute(deps: AuthDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get(
      '/auth/callback',
      {
        schema: callbackRouteSchema,
        config: {
          rateLimit: {
            max: RATE_LIMIT_CALLBACK_MAX,
            timeWindow: RATE_LIMIT_CALLBACK_WINDOW_MS,
          },
        },
        onRequest: async (_request, reply) => {
          clearTransactionCookie(reply, deps.config);
        },
        preValidation: async (request) => {
          if (typeof request.query === 'object' && request.query !== null) {
            for (const [, v] of Object.entries(request.query)) {
              if (Array.isArray(v) || typeof v !== 'string') {
                throw new OidcCallbackInvalidError();
              }
            }
          }
          parseAndValidateRawCallback(request.raw?.url ?? request.url ?? '');
        },
      },
      async (request, reply) => {
        if (
          !deps.config.enabled ||
          !deps.oidcProtocolPort ||
          !deps.loginTransactionStore ||
          !deps.sessionStore ||
          !deps.identityResolution ||
          !deps.crypto ||
          !deps.generateId
        ) {
          throw new AuthConfigurationUnavailableError();
        }

        const rawQuery = parseAndValidateRawCallback(request.raw?.url ?? request.url ?? '');
        const transactionCookie = request.cookies[COOKIE_TRANSACTION];
        clearTransactionCookie(reply, deps.config);

        const result = await completeOidcLogin(
          {
            query: rawQuery,
            transactionCookie,
          },
          {
            crypto: deps.crypto,
            transactionStore: deps.loginTransactionStore,
            sessionStore: deps.sessionStore,
            oidc: deps.oidcProtocolPort,
            identityResolution: deps.identityResolution,
            generateId: deps.generateId,
            now: deps.now ?? (() => new Date()),
            sessionIdleTtlSeconds: deps.config.sessionIdleTtlSeconds,
            sessionAbsoluteTtlSeconds: deps.config.sessionAbsoluteTtlSeconds,
          },
        );

        const validatedReturnTo = validateReturnTo(result.returnTo);
        const appBaseUrl = deps.appBaseUrl ?? 'http://127.0.0.1:3000';
        const destinationUrl = new URL(validatedReturnTo, appBaseUrl).toString();

        const currentNow = deps.now ? deps.now() : new Date();
        setSessionCookie(
          reply,
          result.sessionToken,
          result.absoluteExpiresAt,
          deps.config,
          currentNow,
        );

        return reply.status(303).redirect(destinationUrl);
      },
    );
  };
}
