import type { FastifyPluginAsync } from 'fastify';
import { sendProblemResponse } from '../auth/problem-details.js';
import {
  RATE_LIMIT_CREATE_WORKSPACE_MAX,
  RATE_LIMIT_CREATE_WORKSPACE_WINDOW_MS,
} from './constants.js';
import { handleCreateWorkspace } from './create-workspace-handler.js';
import { handleGetWorkspace } from './get-workspace-handler.js';
import { createWorkspaceRouteSchema, getWorkspaceRouteSchema } from './schemas.js';
import type { WorkspaceRouteDependencies } from './types.js';

export function createWorkspaceRoutes(deps: WorkspaceRouteDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.addHook('onSend', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      reply.header('Referrer-Policy', 'no-referrer');
    });

    fastify.setErrorHandler((error, request, reply) => {
      sendProblemResponse(reply, request, error);
    });

    fastify.post(
      '/api/v1/workspaces',
      {
        schema: createWorkspaceRouteSchema,
        config: {
          rateLimit: {
            max: RATE_LIMIT_CREATE_WORKSPACE_MAX,
            timeWindow: RATE_LIMIT_CREATE_WORKSPACE_WINDOW_MS,
          },
        },
      },
      async (request, reply) => {
        await handleCreateWorkspace(request, reply, deps);
      },
    );

    fastify.get(
      '/api/v1/workspaces/:workspaceId',
      { schema: getWorkspaceRouteSchema },
      async (request, reply) => {
        await handleGetWorkspace(request, reply, deps);
      },
    );
  };
}
