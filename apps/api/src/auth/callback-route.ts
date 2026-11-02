import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  AuthConfigurationUnavailableError,
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
      },
      async (request, reply) => {
        if (
          !deps.config.enabled ||
          !deps.oidcProtocolPort ||
          !deps.loginTransactionStore ||
          !deps.sessionStore ||
          !deps.identityResolution ||
          !deps.crypto
        ) {
          throw new AuthConfigurationUnavailableError();
        }

        const transactionCookie = request.cookies[COOKIE_TRANSACTION];
        clearTransactionCookie(reply, deps.config);

        const result = await completeOidcLogin(
          {
            query: request.query,
            transactionCookie,
          },
          {
            crypto: deps.crypto,
            transactionStore: deps.loginTransactionStore,
            sessionStore: deps.sessionStore,
            oidc: deps.oidcProtocolPort,
            identityResolution: deps.identityResolution,
            generateId: deps.generateId ?? (() => randomUUID()),
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
