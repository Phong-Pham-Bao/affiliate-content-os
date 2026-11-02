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
        preValidation: async (request) => {
          const rawUrl = new URL(request.raw?.url ?? request.url, 'http://127.0.0.1');
          const queryEntries = [...rawUrl.searchParams.entries()];
          const seenKeys = new Set<string>();
          for (const [key] of queryEntries) {
            if (seenKeys.has(key)) {
              throw new OidcCallbackInvalidError();
            }
            seenKeys.add(key);
            if (
              key !== 'code' &&
              key !== 'state' &&
              key !== 'error' &&
              key !== 'error_description' &&
              key !== 'error_uri'
            ) {
              throw new OidcCallbackInvalidError();
            }
          }
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

        const transactionCookie = request.cookies[COOKIE_TRANSACTION];
        clearTransactionCookie(reply, deps.config);

        // Extract raw URL search parameters to preserve unknown/duplicate keys before Fastify strips them
        const rawUrl = new URL(request.raw?.url ?? request.url, 'http://127.0.0.1');
        const queryEntries = [...rawUrl.searchParams.entries()];

        const seenKeys = new Set<string>();
        const rawQuery: Record<string, string> = Object.create(null);
        for (const [key, value] of queryEntries) {
          if (seenKeys.has(key)) {
            throw new OidcCallbackInvalidError();
          }
          seenKeys.add(key);
          rawQuery[key] = value;
        }

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
