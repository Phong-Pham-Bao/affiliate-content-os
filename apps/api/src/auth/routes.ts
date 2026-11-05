import type { FastifyPluginAsync } from 'fastify';
import { createCallbackRoute } from './callback-route.js';
import { createLoginRoute } from './login-route.js';
import { createLogoutRoute } from './logout-route.js';
import { createMeRoute } from './me-route.js';
import { sendProblemResponse } from './problem-details.js';
import type { AuthDependencies } from './types.js';

export function createAuthRoutes(deps: AuthDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.addHook('onSend', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      reply.header('Referrer-Policy', 'no-referrer');
    });

    fastify.setErrorHandler((error, request, reply) => {
      sendProblemResponse(reply, request, error);
    });

    await fastify.register(createLoginRoute(deps));
    await fastify.register(createCallbackRoute(deps));
    await fastify.register(createMeRoute(deps));
    await fastify.register(createLogoutRoute(deps));
  };
}
