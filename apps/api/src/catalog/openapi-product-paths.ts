import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  archiveProductRouteSchema,
  createProductRouteSchema,
  getProductRouteSchema,
  listProductsRouteSchema,
  productResourceSchema,
  updateProductRouteSchema,
} from './product-schemas.js';

const sessionCookieParam = {
  name: 'acos_session',
  in: 'cookie',
  required: true,
  schema: { type: 'string' },
  description: 'Opaque application session token.',
} as const;

const workspaceIdParam = {
  name: 'workspaceId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the workspace.',
} as const;

const productIdParam = {
  name: 'productId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the product.',
} as const;

const originHeaderParam = {
  name: 'Origin',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 2048 },
  description: 'Request origin validated against application base URL.',
} as const;

const idempotencyHeaderParam = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', pattern: '^[!-~]{1,128}$' },
  description: 'Mandatory idempotency key for safe duplicate prevention.',
} as const;

const ifMatchHeaderParam = {
  name: 'If-Match',
  in: 'header',
  required: true,
  schema: { type: 'string' },
  description: 'Target resource version for optimistic concurrency.',
} as const;

export function buildOpenApiProductPaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/products': {
      get: {
        tags: listProductsRouteSchema.tags,
        summary: listProductsRouteSchema.summary,
        description: listProductsRouteSchema.description,
        parameters: [
          workspaceIdParam,
          sessionCookieParam,
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: 'after',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 512 },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['draft', 'active', 'archived'] },
          },
        ],
        responses: {
          '200': {
            description: listProductsRouteSchema.response[200].description,
            headers: commonHeaders,
            content: { 'application/json': { schema: listProductsRouteSchema.response[200] } },
          },
          '400': {
            description: 'Bad Request',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '401': {
            description: 'Unauthorized',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '403': {
            description: 'Forbidden',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '404': {
            description: 'Not Found',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
      post: {
        tags: createProductRouteSchema.tags,
        summary: createProductRouteSchema.summary,
        description: createProductRouteSchema.description,
        parameters: [
          workspaceIdParam,
          idempotencyHeaderParam,
          originHeaderParam,
          sessionCookieParam,
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: createProductRouteSchema.body } },
        },
        responses: {
          '201': {
            description: createProductRouteSchema.response[201].description,
            headers: {
              Location: {
                schema: { type: 'string' },
                description: 'URI of newly created product.',
              },
              ETag: { schema: { type: 'string' }, description: 'Resource version.' },
              ...commonHeaders,
            },
            content: { 'application/json': { schema: productResourceSchema } },
          },
          '400': {
            description: 'Bad Request',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '401': {
            description: 'Unauthorized',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '403': {
            description: 'Forbidden',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '404': {
            description: 'Not Found',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '409': {
            description: 'Conflict',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '429': {
            description: 'Rate Limit Exceeded',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/products/{productId}': {
      get: {
        tags: getProductRouteSchema.tags,
        summary: getProductRouteSchema.summary,
        description: getProductRouteSchema.description,
        parameters: [workspaceIdParam, productIdParam, sessionCookieParam],
        responses: {
          '200': {
            description: getProductRouteSchema.response[200].description,
            headers: {
              ETag: { schema: { type: 'string' }, description: 'Resource version.' },
              ...commonHeaders,
            },
            content: { 'application/json': { schema: productResourceSchema } },
          },
          '400': {
            description: 'Bad Request',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '401': {
            description: 'Unauthorized',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '403': {
            description: 'Forbidden',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '404': {
            description: 'Not Found',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
      patch: {
        tags: updateProductRouteSchema.tags,
        summary: updateProductRouteSchema.summary,
        description: updateProductRouteSchema.description,
        parameters: [
          workspaceIdParam,
          productIdParam,
          ifMatchHeaderParam,
          originHeaderParam,
          sessionCookieParam,
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: updateProductRouteSchema.body } },
        },
        responses: {
          '200': {
            description: updateProductRouteSchema.response[200].description,
            headers: {
              ETag: { schema: { type: 'string' }, description: 'Resource version.' },
              ...commonHeaders,
            },
            content: { 'application/json': { schema: productResourceSchema } },
          },
          '400': {
            description: 'Bad Request',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '401': {
            description: 'Unauthorized',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '403': {
            description: 'Forbidden',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '404': {
            description: 'Not Found',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '409': {
            description: 'Conflict',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '428': {
            description: 'Precondition Required',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '429': {
            description: 'Rate Limit Exceeded',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/products/{productId}/archive': {
      post: {
        tags: archiveProductRouteSchema.tags,
        summary: archiveProductRouteSchema.summary,
        description: archiveProductRouteSchema.description,
        parameters: [workspaceIdParam, productIdParam, originHeaderParam, sessionCookieParam],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: archiveProductRouteSchema.body } },
        },
        responses: {
          '200': {
            description: archiveProductRouteSchema.response[200].description,
            headers: {
              ETag: { schema: { type: 'string' }, description: 'Resource version.' },
              ...commonHeaders,
            },
            content: { 'application/json': { schema: productResourceSchema } },
          },
          '400': {
            description: 'Bad Request',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '401': {
            description: 'Unauthorized',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '403': {
            description: 'Forbidden',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '404': {
            description: 'Not Found',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '429': {
            description: 'Rate Limit Exceeded',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
  };
}
