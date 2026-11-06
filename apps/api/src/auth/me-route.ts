import type { FastifyPluginAsync } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  getCurrentUser,
} from '@affiliate-content-os/application';
import { meRouteSchema } from './schemas.js';
import { requireAuthenticatedSession } from './session-auth.js';
import type { AuthDependencies } from './types.js';

export function createMeRoute(deps: AuthDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get(
      '/api/v1/me',
      {
        schema: meRouteSchema,
      },
      async (request, reply) => {
        if (!deps.workspaceSummary) {
          throw new AuthConfigurationUnavailableError();
        }

        const authContext = await requireAuthenticatedSession(request, reply, deps);

        const data = await getCurrentUser(authContext, {
          workspaceSummary: deps.workspaceSummary,
        });

        return reply.status(200).type('application/json; charset=utf-8').send(data);
      },
    );
  };
}
