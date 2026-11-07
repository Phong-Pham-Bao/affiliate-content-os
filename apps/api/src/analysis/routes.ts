import type { FastifyPluginAsync } from 'fastify';
import { sendProblemResponse } from '../auth/problem-details.js';
import {
  RATE_LIMIT_ANALYSIS_REQUEST_MAX,
  RATE_LIMIT_ANALYSIS_REQUEST_WINDOW_MS,
  RATE_LIMIT_ANALYSIS_REVIEW_MAX,
  RATE_LIMIT_ANALYSIS_REVIEW_WINDOW_MS,
} from './constants.js';
import { handleEnqueueAnalysis, handleUpdateAIPolicy } from './request-handlers.js';
import { handleGetAnalysis, handleGetOperation, handleListAnalyses } from './read-handlers.js';
import { handleAcceptAnalysis, handleRejectAnalysis } from './review-handlers.js';
import {
  acceptAnalysisRouteSchema,
  enqueueAnalysisRouteSchema,
  getAnalysisRouteSchema,
  getOperationRouteSchema,
  listAnalysesRouteSchema,
  rejectAnalysisRouteSchema,
  updateAIPolicyRouteSchema,
} from './schemas.js';
import type { AnalysisRouteDependencies } from './types.js';

export function createAnalysisRoutes(deps: AnalysisRouteDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.addHook('onSend', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      reply.header('Referrer-Policy', 'no-referrer');
    });

    fastify.setErrorHandler((error, request, reply) => {
      sendProblemResponse(reply, request, error);
    });

    const requestRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_ANALYSIS_REQUEST_MAX,
        timeWindow: RATE_LIMIT_ANALYSIS_REQUEST_WINDOW_MS,
      },
    };

    const reviewRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_ANALYSIS_REVIEW_MAX,
        timeWindow: RATE_LIMIT_ANALYSIS_REVIEW_WINDOW_MS,
      },
    };

    // 1 POST /api/v1/workspaces/:workspaceId/products/:productId/analyses
    fastify.post(
      '/api/v1/workspaces/:workspaceId/products/:productId/analyses',
      { schema: enqueueAnalysisRouteSchema, config: requestRateLimit },
      async (request, reply) => {
        await handleEnqueueAnalysis(request, reply, deps);
      },
    );

    // 2 GET /api/v1/workspaces/:workspaceId/products/:productId/analyses
    fastify.get(
      '/api/v1/workspaces/:workspaceId/products/:productId/analyses',
      { schema: listAnalysesRouteSchema },
      async (request, reply) => {
        await handleListAnalyses(request, reply, deps);
      },
    );

    // 3 GET /api/v1/workspaces/:workspaceId/analyses/:analysisId
    fastify.get(
      '/api/v1/workspaces/:workspaceId/analyses/:analysisId',
      { schema: getAnalysisRouteSchema },
      async (request, reply) => {
        await handleGetAnalysis(request, reply, deps);
      },
    );

    // 4 POST /api/v1/workspaces/:workspaceId/analyses/:analysisId/accept
    fastify.post(
      '/api/v1/workspaces/:workspaceId/analyses/:analysisId/accept',
      { schema: acceptAnalysisRouteSchema, config: reviewRateLimit },
      async (request, reply) => {
        await handleAcceptAnalysis(request, reply, deps);
      },
    );

    // 5 POST /api/v1/workspaces/:workspaceId/analyses/:analysisId/reject
    fastify.post(
      '/api/v1/workspaces/:workspaceId/analyses/:analysisId/reject',
      { schema: rejectAnalysisRouteSchema, config: reviewRateLimit },
      async (request, reply) => {
        await handleRejectAnalysis(request, reply, deps);
      },
    );

    // 6 GET /api/v1/workspaces/:workspaceId/operations/:operationId
    fastify.get(
      '/api/v1/workspaces/:workspaceId/operations/:operationId',
      { schema: getOperationRouteSchema },
      async (request, reply) => {
        await handleGetOperation(request, reply, deps);
      },
    );

    // 7 PUT /api/v1/workspaces/:workspaceId/ai-policy
    fastify.put(
      '/api/v1/workspaces/:workspaceId/ai-policy',
      { schema: updateAIPolicyRouteSchema, config: reviewRateLimit },
      async (request, reply) => {
        await handleUpdateAIPolicy(request, reply, deps);
      },
    );
  };
}
