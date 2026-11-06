import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  affiliateResourceSchema,
  archiveAffiliateDestinationRouteSchema,
  createAffiliateDestinationRouteSchema,
  listAffiliateDestinationsRouteSchema,
  updateAffiliateDestinationRouteSchema,
} from './affiliate-schemas.js';

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

const destinationIdParam = {
  name: 'destinationId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the affiliate destination.',
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

export function buildOpenApiAffiliatePaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/products/{productId}/affiliate-destinations': {
      get: {
        tags: listAffiliateDestinationsRouteSchema.tags,
        summary: listAffiliateDestinationsRouteSchema.summary,
        description: listAffiliateDestinationsRouteSchema.description,
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
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['active', 'archived'] },
          },
        ],
        responses: {
          '200': {
            description: listAffiliateDestinationsRouteSchema.response[200].description,
            headers: commonHeaders,
            content: {
              'application/json': { schema: listAffiliateDestinationsRouteSchema.response[200] },
            },
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
        tags: createAffiliateDestinationRouteSchema.tags,
        summary: createAffiliateDestinationRouteSchema.summary,
        description: createAffiliateDestinationRouteSchema.description,
        parameters: [
          workspaceIdParam,
          productIdParam,
          idempotencyHeaderParam,
          originHeaderParam,
          sessionCookieParam,
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: createAffiliateDestinationRouteSchema.body } },
        },
        responses: {
          '201': {
            description: createAffiliateDestinationRouteSchema.response[201].description,
            headers: {
              Location: {
                schema: { type: 'string' },
                description: 'URI of newly created affiliate destination.',
              },
              ETag: { schema: { type: 'string' }, description: 'Resource version.' },
              ...commonHeaders,
            },
            content: { 'application/json': { schema: affiliateResourceSchema } },
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
    '/api/v1/workspaces/{workspaceId}/products/{productId}/affiliate-destinations/{destinationId}':
      {
        patch: {
          tags: updateAffiliateDestinationRouteSchema.tags,
          summary: updateAffiliateDestinationRouteSchema.summary,
          description: updateAffiliateDestinationRouteSchema.description,
          parameters: [
            workspaceIdParam,
            productIdParam,
            destinationIdParam,
            ifMatchHeaderParam,
            originHeaderParam,
            sessionCookieParam,
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: updateAffiliateDestinationRouteSchema.body } },
          },
          responses: {
            '200': {
              description: updateAffiliateDestinationRouteSchema.response[200].description,
              headers: {
                ETag: { schema: { type: 'string' }, description: 'Resource version.' },
                ...commonHeaders,
              },
              content: { 'application/json': { schema: affiliateResourceSchema } },
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
    '/api/v1/workspaces/{workspaceId}/products/{productId}/affiliate-destinations/{destinationId}/archive':
      {
        post: {
          tags: archiveAffiliateDestinationRouteSchema.tags,
          summary: archiveAffiliateDestinationRouteSchema.summary,
          description: archiveAffiliateDestinationRouteSchema.description,
          parameters: [
            workspaceIdParam,
            productIdParam,
            destinationIdParam,
            originHeaderParam,
            sessionCookieParam,
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': { schema: archiveAffiliateDestinationRouteSchema.body },
            },
          },
          responses: {
            '200': {
              description: archiveAffiliateDestinationRouteSchema.response[200].description,
              headers: {
                ETag: { schema: { type: 'string' }, description: 'Resource version.' },
                ...commonHeaders,
              },
              content: { 'application/json': { schema: affiliateResourceSchema } },
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
