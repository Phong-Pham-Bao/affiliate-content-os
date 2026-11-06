import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  confirmFactSetRouteSchema,
  createFactSetRouteSchema,
  factSetDetailResponseSchema,
  getFactSetRouteSchema,
  listFactSetsRouteSchema,
} from './fact-schemas.js';

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

const factSetIdParam = {
  name: 'factSetId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the fact set revision.',
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

export function buildOpenApiFactPaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/products/{productId}/fact-sets': {
      get: {
        tags: listFactSetsRouteSchema.tags,
        summary: listFactSetsRouteSchema.summary,
        description: listFactSetsRouteSchema.description,
        parameters: [
          workspaceIdParam,
          productIdParam,
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
        ],
        responses: {
          '200': {
            description: listFactSetsRouteSchema.response[200].description,
            headers: commonHeaders,
            content: { 'application/json': { schema: listFactSetsRouteSchema.response[200] } },
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
        tags: createFactSetRouteSchema.tags,
        summary: createFactSetRouteSchema.summary,
        description: createFactSetRouteSchema.description,
        parameters: [
          workspaceIdParam,
          productIdParam,
          idempotencyHeaderParam,
          originHeaderParam,
          sessionCookieParam,
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: createFactSetRouteSchema.body } },
        },
        responses: {
          '201': {
            description: createFactSetRouteSchema.response[201].description,
            headers: {
              Location: {
                schema: { type: 'string' },
                description: 'URI of newly created fact set.',
              },
              ETag: { schema: { type: 'string' }, description: 'Resource version.' },
              ...commonHeaders,
            },
            content: { 'application/json': { schema: factSetDetailResponseSchema } },
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
    '/api/v1/workspaces/{workspaceId}/products/{productId}/fact-sets/{factSetId}': {
      get: {
        tags: getFactSetRouteSchema.tags,
        summary: getFactSetRouteSchema.summary,
        description: getFactSetRouteSchema.description,
        parameters: [workspaceIdParam, productIdParam, factSetIdParam, sessionCookieParam],
        responses: {
          '200': {
            description: getFactSetRouteSchema.response[200].description,
            headers: {
              ETag: { schema: { type: 'string' }, description: 'Resource version.' },
              ...commonHeaders,
            },
            content: { 'application/json': { schema: factSetDetailResponseSchema } },
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
    },
    '/api/v1/workspaces/{workspaceId}/products/{productId}/fact-sets/{factSetId}/confirm': {
      post: {
        tags: confirmFactSetRouteSchema.tags,
        summary: confirmFactSetRouteSchema.summary,
        description: confirmFactSetRouteSchema.description,
        parameters: [
          workspaceIdParam,
          productIdParam,
          factSetIdParam,
          originHeaderParam,
          sessionCookieParam,
        ],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: confirmFactSetRouteSchema.body } },
        },
        responses: {
          '200': {
            description: confirmFactSetRouteSchema.response[200].description,
            headers: {
              ETag: { schema: { type: 'string' }, description: 'Resource version.' },
              ...commonHeaders,
            },
            content: { 'application/json': { schema: confirmFactSetRouteSchema.response[200] } },
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
