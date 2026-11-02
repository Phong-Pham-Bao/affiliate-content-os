import type { FastifyPluginAsync } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  AuthRequestValidationError,
  logoutApplicationSession,
} from '@affiliate-content-os/application';
import { COOKIE_SESSION, RATE_LIMIT_LOGOUT_MAX, RATE_LIMIT_LOGOUT_WINDOW_MS } from './constants.js';
import { clearSessionCookie } from './cookies.js';
import { validateOrigin } from './origin.js';
import { logoutRouteSchema } from './schemas.js';
import type { AuthDependencies } from './types.js';

export function createLogoutRoute(deps: AuthDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post(
      '/api/v1/logout',
      {
        schema: logoutRouteSchema,
        config: {
          rateLimit: {
            max: RATE_LIMIT_LOGOUT_MAX,
            timeWindow: RATE_LIMIT_LOGOUT_WINDOW_MS,
          },
        },
      },
      async (request, reply) => {
        if (!deps.config.enabled || !deps.sessionStore || !deps.crypto) {
          throw new AuthConfigurationUnavailableError();
        }

        const appBaseUrl = deps.appBaseUrl ?? 'http://127.0.0.1:3000';
        const redirectUri = deps.config.redirectUri ?? appBaseUrl;
        validateOrigin(request.headers['origin'], appBaseUrl, redirectUri);

        const queryKeys = request.query ? Object.keys(request.query as object) : [];
        if (queryKeys.length > 0 || (request.body !== undefined && request.body !== null)) {
          throw new AuthRequestValidationError('session');
        }

        clearSessionCookie(reply, deps.config);

        const sessionCookie = request.cookies[COOKIE_SESSION];
        if (sessionCookie) {
          await logoutApplicationSession(
            { sessionCookie },
            {
              crypto: deps.crypto,
              sessionStore: deps.sessionStore,
              now: deps.now ?? (() => new Date()),
            },
          );
        }

        return reply.status(204).send();
      },
    );
  };
}
