import type { FastifyPluginAsync } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  AuthRequestValidationError,
  beginOidcLogin,
  validateReturnTo,
} from '@affiliate-content-os/application';
import { RATE_LIMIT_LOGIN_MAX, RATE_LIMIT_LOGIN_WINDOW_MS } from './constants.js';
import { setTransactionCookie } from './cookies.js';
import { loginRouteSchema } from './schemas.js';
import type { AuthDependencies } from './types.js';

export function createLoginRoute(deps: AuthDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get(
      '/auth/login',
      {
        schema: loginRouteSchema,
        config: {
          rateLimit: {
            max: RATE_LIMIT_LOGIN_MAX,
            timeWindow: RATE_LIMIT_LOGIN_WINDOW_MS,
          },
        },
      },
      async (request, reply) => {
        if (
          !deps.config.enabled ||
          !deps.oidcProtocolPort ||
          !deps.loginTransactionStore ||
          !deps.crypto ||
          !deps.generateId
        ) {
          throw new AuthConfigurationUnavailableError();
        }

        const rawUrlStr = request.raw?.url ?? request.url ?? '';
        let rawReturnTo: string | undefined;

        const qIdx = rawUrlStr.indexOf('?');
        if (qIdx !== -1) {
          const rawQuery = rawUrlStr.slice(qIdx + 1);
          if (rawQuery.includes('?')) {
            throw new AuthRequestValidationError('returnTo');
          }
          if (rawQuery.startsWith('&') || rawQuery.endsWith('&') || rawQuery.includes('&&')) {
            throw new AuthRequestValidationError('returnTo');
          }

          const pairs = rawQuery.split('&');
          let returnToCount = 0;
          const seenKeys = new Set<string>();

          for (const pair of pairs) {
            const eqIdx = pair.indexOf('=');
            const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
            const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);

            for (let i = 0; i < rawKey.length; i++) {
              if (rawKey[i] === '%') {
                if (
                  i + 2 >= rawKey.length ||
                  !/^[0-9a-fA-F]{2}$/.test(rawKey.slice(i + 1, i + 3))
                ) {
                  throw new AuthRequestValidationError('returnTo');
                }
              }
            }

            let decodedKey: string;
            try {
              decodedKey = decodeURIComponent(rawKey);
            } catch {
              throw new AuthRequestValidationError('returnTo');
            }

            if (decodedKey !== 'returnTo') {
              throw new AuthRequestValidationError('returnTo');
            }

            if (seenKeys.has(decodedKey) || seenKeys.has(rawKey)) {
              throw new AuthRequestValidationError('returnTo');
            }
            seenKeys.add(decodedKey);
            seenKeys.add(rawKey);

            returnToCount++;
            if (returnToCount > 1) {
              throw new AuthRequestValidationError('returnTo');
            }

            let decodedVal: string;
            try {
              decodedVal = decodeURIComponent(rawVal);
            } catch {
              throw new AuthRequestValidationError('returnTo');
            }
            rawReturnTo = decodedVal;
          }
        }

        if (typeof request.query === 'object' && request.query !== null) {
          for (const [k, v] of Object.entries(request.query)) {
            if (k !== 'returnTo' || Array.isArray(v) || typeof v !== 'string') {
              throw new AuthRequestValidationError('returnTo');
            }
          }
        }

        const returnTo = validateReturnTo(rawReturnTo ?? '/');

        const result = await beginOidcLogin(
          { returnTo },
          {
            crypto: deps.crypto,
            transactionStore: deps.loginTransactionStore,
            oidc: deps.oidcProtocolPort,
            generateId: deps.generateId,
            now: deps.now ?? (() => new Date()),
            transactionTtlSeconds: deps.config.transactionTtlSeconds,
          },
        );

        setTransactionCookie(reply, result.transactionCookieValue, deps.config);
        return reply.status(302).redirect(result.authorizationUrl);
      },
    );
  };
}
