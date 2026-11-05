import type { FastifyPluginAsync } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  OidcCallbackInvalidError,
  completeOidcLogin,
  validateReturnTo,
} from '@affiliate-content-os/application';
import { parseAndValidateRawCallback } from './callback-url-parser.js';
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
        const absoluteExpiresDate = new Date(result.absoluteExpiresAt);
        setSessionCookie(reply, result.sessionToken, absoluteExpiresDate, deps.config, currentNow);

        return reply.status(303).redirect(destinationUrl);
      },
    );
  };
}
