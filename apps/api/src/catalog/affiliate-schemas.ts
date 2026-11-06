import { problemDetailsJsonSchema } from '../auth/schemas.js';
import {
  createHeadersSchema,
  mutationHeadersSchema,
  updateHeadersSchema,
} from './product-schemas.js';

export const affiliateResourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'workspaceId',
    'productId',
    'label',
    'url',
    'status',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workspaceId: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    label: { type: 'string', minLength: 1, maxLength: 256 },
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    networkName: { type: ['string', 'null'], maxLength: 128 },
    status: { type: 'string', enum: ['active', 'archived'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
    alreadyArchived: { type: 'boolean' },
  },
} as const;

export const listAffiliateDestinationsRouteSchema = {
  tags: ['Catalog'],
  summary: 'List affiliate destinations for product',
  description: 'Returns affiliate destinations for a product with optional status filtering.',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'productId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      after: { type: 'string', maxLength: 512 },
      status: { type: 'string', enum: ['active', 'archived'] },
    },
  },
  response: {
    200: {
      description: 'Paginated list of affiliate destinations',
      type: 'object',
      additionalProperties: false,
      required: ['items', 'page'],
      properties: {
        items: { type: 'array', items: affiliateResourceSchema },
        page: {
          type: 'object',
          additionalProperties: false,
          required: ['nextCursor', 'hasMore'],
          properties: {
            nextCursor: { type: ['string', 'null'] },
            hasMore: { type: 'boolean' },
          },
        },
      },
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
  },
} as const;

export const createAffiliateDestinationRouteSchema = {
  tags: ['Catalog'],
  summary: 'Create affiliate destination',
  description: 'Creates a new active affiliate destination for a product.',
  headers: createHeadersSchema,
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'productId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'url'],
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 256 },
      url: { type: 'string', minLength: 1, maxLength: 2048 },
      networkName: { type: ['string', 'null'], maxLength: 128 },
    },
  },
  response: {
    201: {
      description: 'Affiliate destination created successfully',
      ...affiliateResourceSchema,
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
    409: { description: 'Conflict', ...problemDetailsJsonSchema },
    429: { description: 'Rate Limit Exceeded', ...problemDetailsJsonSchema },
  },
} as const;

export const updateAffiliateDestinationRouteSchema = {
  tags: ['Catalog'],
  summary: 'Update affiliate destination',
  description: 'Versioned update requiring If-Match header.',
  headers: updateHeadersSchema,
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'productId', 'destinationId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      destinationId: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 256 },
      url: { type: 'string', minLength: 1, maxLength: 2048 },
      networkName: { type: ['string', 'null'], maxLength: 128 },
    },
  },
  response: {
    200: {
      description: 'Affiliate destination updated successfully',
      ...affiliateResourceSchema,
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
    409: { description: 'Conflict', ...problemDetailsJsonSchema },
    428: { description: 'Precondition Required', ...problemDetailsJsonSchema },
    429: { description: 'Rate Limit Exceeded', ...problemDetailsJsonSchema },
  },
} as const;

export const archiveAffiliateDestinationRouteSchema = {
  tags: ['Catalog'],
  summary: 'Archive affiliate destination',
  description: 'Idempotently archives an affiliate destination.',
  headers: mutationHeadersSchema,
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'productId', 'destinationId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      destinationId: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: ['object', 'null'],
    additionalProperties: false,
  },
  response: {
    200: {
      description: 'Affiliate destination archived successfully',
      ...affiliateResourceSchema,
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
    429: { description: 'Rate Limit Exceeded', ...problemDetailsJsonSchema },
  },
} as const;
