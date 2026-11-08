import type { FastifyPluginAsync } from 'fastify';
import { sendProblemResponse } from '../auth/problem-details.js';
import {
  RATE_LIMIT_WORKFORCE_KICKOFF_MAX,
  RATE_LIMIT_WORKFORCE_KICKOFF_WINDOW_MS,
  RATE_LIMIT_WORKFORCE_READ_MAX,
  RATE_LIMIT_WORKFORCE_READ_WINDOW_MS,
  RATE_LIMIT_WORKFORCE_RETRY_MAX,
  RATE_LIMIT_WORKFORCE_RETRY_WINDOW_MS,
} from './constants.js';
import { handleKickoffWorkOrder, handleRetryWorkOrderPlanning } from './mutation-handlers.js';
import {
  handleGetArtifactById,
  handleGetWorkOrder,
  handleListWorkOrderActivities,
  handleListWorkOrderArtifacts,
  handleListWorkOrders,
} from './read-handlers.js';
import {
  getArtifactByIdRouteSchema,
  getWorkOrderRouteSchema,
  kickoffWorkOrderRouteSchema,
  listWorkOrderActivitiesRouteSchema,
  listWorkOrderArtifactsRouteSchema,
  listWorkOrdersRouteSchema,
  retryWorkOrderPlanningRouteSchema,
} from './schemas.js';
import type { WorkforceRouteDependencies } from './types.js';

export function createWorkforceRoutes(deps: WorkforceRouteDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.addHook('onSend', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      reply.header('Referrer-Policy', 'no-referrer');
    });

    fastify.setErrorHandler((error, request, reply) => {
      sendProblemResponse(reply, request, error);
    });

    const kickoffRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_WORKFORCE_KICKOFF_MAX,
        timeWindow: RATE_LIMIT_WORKFORCE_KICKOFF_WINDOW_MS,
      },
    };

    const readRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_WORKFORCE_READ_MAX,
        timeWindow: RATE_LIMIT_WORKFORCE_READ_WINDOW_MS,
      },
    };

    const retryRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_WORKFORCE_RETRY_MAX,
        timeWindow: RATE_LIMIT_WORKFORCE_RETRY_WINDOW_MS,
      },
    };

    fastify.post(
      '/api/v1/workspaces/:workspaceId/products/:productId/work-orders',
      { schema: kickoffWorkOrderRouteSchema, config: kickoffRateLimit },
      async (request, reply) => {
        await handleKickoffWorkOrder(request, reply, deps);
      },
    );

    fastify.get(
      '/api/v1/workspaces/:workspaceId/work-orders/:workOrderId',
      { schema: getWorkOrderRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleGetWorkOrder(request, reply, deps);
      },
    );

    fastify.get(
      '/api/v1/workspaces/:workspaceId/work-orders',
      { schema: listWorkOrdersRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleListWorkOrders(request, reply, deps);
      },
    );

    fastify.get(
      '/api/v1/workspaces/:workspaceId/work-orders/:workOrderId/artifacts',
      { schema: listWorkOrderArtifactsRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleListWorkOrderArtifacts(request, reply, deps);
      },
    );

    fastify.get(
      '/api/v1/workspaces/:workspaceId/artifacts/:artifactId',
      { schema: getArtifactByIdRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleGetArtifactById(request, reply, deps);
      },
    );

    fastify.get(
      '/api/v1/workspaces/:workspaceId/work-orders/:workOrderId/activity',
      { schema: listWorkOrderActivitiesRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleListWorkOrderActivities(request, reply, deps);
      },
    );

    fastify.post(
      '/api/v1/workspaces/:workspaceId/work-orders/:workOrderId/retry',
      { schema: retryWorkOrderPlanningRouteSchema, config: retryRateLimit },
      async (request, reply) => {
        await handleRetryWorkOrderPlanning(request, reply, deps);
      },
    );
  };
}
