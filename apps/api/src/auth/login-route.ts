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

        const rawUrl = new URL(request.raw?.url ?? request.url, 'http://127.0.0.1');
        for (const key of rawUrl.searchParams.keys()) {
          if (key !== 'returnTo') {
            throw new AuthRequestValidationError('returnTo');
          }
        }

        const rawReturnTo = rawUrl.searchParams.get('returnTo');
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
