import type { FastifyPluginAsync } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  authenticateApplicationSession,
  getCurrentUser,
} from '@affiliate-content-os/application';
import { COOKIE_SESSION } from './constants.js';
import { clearSessionCookie, setSessionCookie } from './cookies.js';
import { meRouteSchema } from './schemas.js';
import type { AuthDependencies } from './types.js';

export function createMeRoute(deps: AuthDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get(
      '/api/v1/me',
      {
        schema: meRouteSchema,
      },
      async (request, reply) => {
        if (
          !deps.config.enabled ||
          !deps.sessionStore ||
          !deps.userDirectory ||
          !deps.workspaceSummary ||
          !deps.crypto
        ) {
          throw new AuthConfigurationUnavailableError();
        }

        const sessionCookie = request.cookies[COOKIE_SESSION];
        let authContext;
        try {
          authContext = await authenticateApplicationSession(
            { sessionCookie },
            {
              crypto: deps.crypto,
              sessionStore: deps.sessionStore,
              userDirectory: deps.userDirectory,
              now: deps.now ?? (() => new Date()),
              sessionIdleTtlSeconds: deps.config.sessionIdleTtlSeconds,
              sessionRotationSeconds: deps.config.sessionRotationSeconds,
              sessionRotationGraceSeconds: deps.config.sessionRotationGraceSeconds,
              sessionTouchIntervalSeconds: deps.config.sessionTouchIntervalSeconds,
            },
          );
        } catch (err) {
          clearSessionCookie(reply, deps.config);
          throw err;
        }

        const currentNow = deps.now ? deps.now() : new Date();
        if (authContext.rotatedToken !== null) {
          setSessionCookie(
            reply,
            authContext.rotatedToken,
            new Date(authContext.session.absoluteExpiresAt),
            deps.config,
            currentNow,
          );
        }

        const data = await getCurrentUser(authContext, {
          workspaceSummary: deps.workspaceSummary,
        });

        return reply.status(200).type('application/json; charset=utf-8').send(data);
      },
    );
  };
}
