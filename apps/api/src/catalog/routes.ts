import type { FastifyPluginAsync } from 'fastify';
import { sendProblemResponse } from '../auth/problem-details.js';
import {
  handleArchiveAffiliateDestination,
  handleCreateAffiliateDestination,
  handleListAffiliateDestinations,
  handleUpdateAffiliateDestination,
} from './affiliate-handlers.js';
import {
  archiveAffiliateDestinationRouteSchema,
  createAffiliateDestinationRouteSchema,
  listAffiliateDestinationsRouteSchema,
  updateAffiliateDestinationRouteSchema,
} from './affiliate-schemas.js';
import {
  RATE_LIMIT_CATALOG_MUTATION_MAX,
  RATE_LIMIT_CATALOG_MUTATION_WINDOW_MS,
} from './constants.js';
import {
  handleConfirmFactSet,
  handleCreateFactSet,
  handleGetFactSet,
  handleListFactSets,
} from './fact-handlers.js';
import {
  confirmFactSetRouteSchema,
  createFactSetRouteSchema,
  getFactSetRouteSchema,
  listFactSetsRouteSchema,
} from './fact-schemas.js';
import {
  handleArchiveProduct,
  handleCreateProduct,
  handleGetProduct,
  handleListProducts,
  handleUpdateProduct,
} from './product-handlers.js';
import {
  archiveProductRouteSchema,
  createProductRouteSchema,
  getProductRouteSchema,
  listProductsRouteSchema,
  updateProductRouteSchema,
} from './product-schemas.js';
import type { CatalogRouteDependencies } from './types.js';

export function createCatalogRoutes(deps: CatalogRouteDependencies): FastifyPluginAsync {
  return async (fastify) => {
    fastify.addHook('onSend', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      reply.header('Referrer-Policy', 'no-referrer');
    });

    fastify.setErrorHandler((error, request, reply) => {
      sendProblemResponse(reply, request, error);
    });

    const mutationConfig = {
      rateLimit: {
        max: RATE_LIMIT_CATALOG_MUTATION_MAX,
        timeWindow: RATE_LIMIT_CATALOG_MUTATION_WINDOW_MS,
      },
    };

    // 1 GET /api/v1/workspaces/:workspaceId/products
    fastify.get(
      '/api/v1/workspaces/:workspaceId/products',
      { schema: listProductsRouteSchema },
      async (request, reply) => {
        await handleListProducts(request, reply, deps);
      },
    );

    // 2 POST /api/v1/workspaces/:workspaceId/products
    fastify.post(
      '/api/v1/workspaces/:workspaceId/products',
      { schema: createProductRouteSchema, config: mutationConfig },
      async (request, reply) => {
        await handleCreateProduct(request, reply, deps);
      },
    );

    // 3 GET /api/v1/workspaces/:workspaceId/products/:productId
    fastify.get(
      '/api/v1/workspaces/:workspaceId/products/:productId',
      { schema: getProductRouteSchema },
      async (request, reply) => {
        await handleGetProduct(request, reply, deps);
      },
    );

    // 4 PATCH /api/v1/workspaces/:workspaceId/products/:productId
    fastify.patch(
      '/api/v1/workspaces/:workspaceId/products/:productId',
      { schema: updateProductRouteSchema, config: mutationConfig },
      async (request, reply) => {
        await handleUpdateProduct(request, reply, deps);
      },
    );

    // 5 POST /api/v1/workspaces/:workspaceId/products/:productId/archive
    fastify.post(
      '/api/v1/workspaces/:workspaceId/products/:productId/archive',
      { schema: archiveProductRouteSchema, config: mutationConfig },
      async (request, reply) => {
        await handleArchiveProduct(request, reply, deps);
      },
    );

    // 6 GET /api/v1/workspaces/:workspaceId/products/:productId/fact-sets
    fastify.get(
      '/api/v1/workspaces/:workspaceId/products/:productId/fact-sets',
      { schema: listFactSetsRouteSchema },
      async (request, reply) => {
        await handleListFactSets(request, reply, deps);
      },
    );

    // 7 POST /api/v1/workspaces/:workspaceId/products/:productId/fact-sets
    fastify.post(
      '/api/v1/workspaces/:workspaceId/products/:productId/fact-sets',
      { schema: createFactSetRouteSchema, config: mutationConfig },
      async (request, reply) => {
        await handleCreateFactSet(request, reply, deps);
      },
    );

    // 8 GET /api/v1/workspaces/:workspaceId/products/:productId/fact-sets/:factSetId
    fastify.get(
      '/api/v1/workspaces/:workspaceId/products/:productId/fact-sets/:factSetId',
      { schema: getFactSetRouteSchema },
      async (request, reply) => {
        await handleGetFactSet(request, reply, deps);
      },
    );

    // 9 POST /api/v1/workspaces/:workspaceId/products/:productId/fact-sets/:factSetId/confirm
    fastify.post(
      '/api/v1/workspaces/:workspaceId/products/:productId/fact-sets/:factSetId/confirm',
      { schema: confirmFactSetRouteSchema, config: mutationConfig },
      async (request, reply) => {
        await handleConfirmFactSet(request, reply, deps);
      },
    );

    // 10 GET /api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations
    fastify.get(
      '/api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations',
      { schema: listAffiliateDestinationsRouteSchema },
      async (request, reply) => {
        await handleListAffiliateDestinations(request, reply, deps);
      },
    );

    // 11 POST /api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations
    fastify.post(
      '/api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations',
      { schema: createAffiliateDestinationRouteSchema, config: mutationConfig },
      async (request, reply) => {
        await handleCreateAffiliateDestination(request, reply, deps);
      },
    );

    // 12 PATCH /api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations/:destinationId
    fastify.patch(
      '/api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations/:destinationId',
      { schema: updateAffiliateDestinationRouteSchema, config: mutationConfig },
      async (request, reply) => {
        await handleUpdateAffiliateDestination(request, reply, deps);
      },
    );

    // 13 POST /api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations/:destinationId/archive
    fastify.post(
      '/api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations/:destinationId/archive',
      { schema: archiveAffiliateDestinationRouteSchema, config: mutationConfig },
      async (request, reply) => {
        await handleArchiveAffiliateDestination(request, reply, deps);
      },
    );
  };
}
