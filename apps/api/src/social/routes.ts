import type { FastifyPluginAsync } from 'fastify';
import { sendProblemResponse } from '../auth/problem-details.js';
import { handleAuthorizeSocialConnection } from './authorize-handler.js';
import { handleSocialCallback } from './callback-handler.js';
import {
  RATE_LIMIT_SOCIAL_AUTHORIZE_MAX,
  RATE_LIMIT_SOCIAL_AUTHORIZE_WINDOW_MS,
  RATE_LIMIT_SOCIAL_CALLBACK_MAX,
  RATE_LIMIT_SOCIAL_CALLBACK_WINDOW_MS,
  RATE_LIMIT_SOCIAL_READ_MAX,
  RATE_LIMIT_SOCIAL_READ_WINDOW_MS,
} from './constants.js';
import { handleGetCallbackResult, handleListSocialAccounts } from './read-handlers.js';
import {
  authorizeSocialConnectionRouteSchema,
  getCallbackResultRouteSchema,
  listSocialAccountsRouteSchema,
  socialCallbackRouteSchema,
} from './schemas.js';
import type { SocialRouteDependencies } from './types.js';

export function createSocialRoutes(deps: SocialRouteDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.addHook('onSend', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      reply.header('Referrer-Policy', 'no-referrer');
    });

    fastify.setErrorHandler((error, request, reply) => {
      sendProblemResponse(reply, request, error);
    });

    const authorizeRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_SOCIAL_AUTHORIZE_MAX,
        timeWindow: RATE_LIMIT_SOCIAL_AUTHORIZE_WINDOW_MS,
      },
    };

    const callbackRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_SOCIAL_CALLBACK_MAX,
        timeWindow: RATE_LIMIT_SOCIAL_CALLBACK_WINDOW_MS,
      },
    };

    const readRateLimit = {
      rateLimit: {
        max: RATE_LIMIT_SOCIAL_READ_MAX,
        timeWindow: RATE_LIMIT_SOCIAL_READ_WINDOW_MS,
      },
    };

    // 1. GET /api/v1/workspaces/:workspaceId/social-accounts
    fastify.get(
      '/api/v1/workspaces/:workspaceId/social-accounts',
      { schema: listSocialAccountsRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleListSocialAccounts(request, reply, deps);
      },
    );

    // 2. POST /api/v1/workspaces/:workspaceId/social-connections/:platform/authorize
    fastify.post(
      '/api/v1/workspaces/:workspaceId/social-connections/:platform/authorize',
      { schema: authorizeSocialConnectionRouteSchema, config: authorizeRateLimit },
      async (request, reply) => {
        await handleAuthorizeSocialConnection(request, reply, deps);
      },
    );

    // 3. GET /api/v1/social-connections/:platform/callback
    fastify.get(
      '/api/v1/social-connections/:platform/callback',
      { schema: socialCallbackRouteSchema, config: callbackRateLimit },
      async (request, reply) => {
        await handleSocialCallback(request, reply, deps);
      },
    );

    // 4. GET /api/v1/workspaces/:workspaceId/social-connections/callback-results/:resultKey
    fastify.get(
      '/api/v1/workspaces/:workspaceId/social-connections/callback-results/:resultKey',
      { schema: getCallbackResultRouteSchema, config: readRateLimit },
      async (request, reply) => {
        await handleGetCallbackResult(request, reply, deps);
      },
    );
  };
}
