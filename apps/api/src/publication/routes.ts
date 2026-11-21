import type { FastifyPluginAsync } from 'fastify';
import { buildProblemDetails, sendProblemResponse } from '../auth/problem-details.js';
import {
  RATE_LIMIT_PUBLICATION_MUTATION_MAX,
  RATE_LIMIT_PUBLICATION_MUTATION_WINDOW_MS,
  RATE_LIMIT_PUBLICATION_READ_MAX,
  RATE_LIMIT_PUBLICATION_READ_WINDOW_MS,
} from './constants.js';
import {
  handleCancelPublication,
  handleCreatePublicationApproval,
  handleCreatePublicationSchedule,
  handleGetPublication,
  handleListPublications,
  handleReschedulePublication,
} from './handlers.js';
import { resolvePublicationProblemSpec } from './problem-details-specs.js';
import {
  cancelPublicationRouteSchema,
  createPublicationApprovalRouteSchema,
  createPublicationScheduleRouteSchema,
  getPublicationRouteSchema,
  listPublicationsRouteSchema,
  reschedulePublicationRouteSchema,
} from './schemas.js';
import type { PublicationRouteDependencies } from './types.js';

export function createPublicationRoutes(deps: PublicationRouteDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.addHook('onSend', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      reply.header('Referrer-Policy', 'no-referrer');
    });

    fastify.setErrorHandler((error, request, reply) => {
      const pubSpec = resolvePublicationProblemSpec(error);
      if (pubSpec) {
        const problem = buildProblemDetails(request, pubSpec);
        void reply
          .status(pubSpec.status)
          .type('application/problem+json; charset=utf-8')
          .send(problem);
        return;
      }
      sendProblemResponse(reply, request, error);
    });

    const mutationRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_PUBLICATION_MUTATION_MAX,
        timeWindow: RATE_LIMIT_PUBLICATION_MUTATION_WINDOW_MS,
      },
    };

    const readRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_PUBLICATION_READ_MAX,
        timeWindow: RATE_LIMIT_PUBLICATION_READ_WINDOW_MS,
      },
    };

    // 1. POST /api/v1/workspaces/:workspaceId/publication-approvals
    fastify.post(
      '/api/v1/workspaces/:workspaceId/publication-approvals',
      { schema: createPublicationApprovalRouteSchema, config: mutationRateLimit },
      async (request, reply) => {
        await handleCreatePublicationApproval(request, reply, deps);
      },
    );

    // 2. POST /api/v1/workspaces/:workspaceId/publications
    fastify.post(
      '/api/v1/workspaces/:workspaceId/publications',
      { schema: createPublicationScheduleRouteSchema, config: mutationRateLimit },
      async (request, reply) => {
        await handleCreatePublicationSchedule(request, reply, deps);
      },
    );

    // 3. GET /api/v1/workspaces/:workspaceId/publications
    fastify.get(
      '/api/v1/workspaces/:workspaceId/publications',
      { schema: listPublicationsRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleListPublications(request, reply, deps);
      },
    );

    // 4. GET /api/v1/workspaces/:workspaceId/publications/:publicationId
    fastify.get(
      '/api/v1/workspaces/:workspaceId/publications/:publicationId',
      { schema: getPublicationRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleGetPublication(request, reply, deps);
      },
    );

    // 5. PATCH /api/v1/workspaces/:workspaceId/publications/:publicationId
    fastify.patch(
      '/api/v1/workspaces/:workspaceId/publications/:publicationId',
      { schema: reschedulePublicationRouteSchema, config: mutationRateLimit },
      async (request, reply) => {
        await handleReschedulePublication(request, reply, deps);
      },
    );

    // 6. POST /api/v1/workspaces/:workspaceId/publications/:publicationId/cancel
    fastify.post(
      '/api/v1/workspaces/:workspaceId/publications/:publicationId/cancel',
      { schema: cancelPublicationRouteSchema, config: mutationRateLimit },
      async (request, reply) => {
        await handleCancelPublication(request, reply, deps);
      },
    );
  };
}
