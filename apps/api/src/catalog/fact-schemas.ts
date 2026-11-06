import { problemDetailsJsonSchema } from '../auth/schemas.js';
import {
  createHeadersSchema,
  mutationHeadersSchema,
  productResourceSchema,
} from './product-schemas.js';

export const factResourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'workspaceId',
    'productId',
    'factSetId',
    'factKey',
    'valueText',
    'sourceType',
    'confidence',
    'claimUsage',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workspaceId: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    factSetId: { type: 'string', format: 'uuid' },
    factKey: { type: 'string', pattern: '^[a-z0-9]+([._-][a-z0-9]+)*$', maxLength: 128 },
    valueText: { type: 'string', minLength: 1, maxLength: 10000 },
    sourceType: { type: 'string', enum: ['user', 'merchant_page', 'document', 'other'] },
    sourceUrl: { type: ['string', 'null'], maxLength: 2048 },
    sourceExcerpt: { type: ['string', 'null'], maxLength: 2048 },
    confidence: { type: 'string', enum: ['confirmed', 'suggested', 'uncertain'] },
    claimUsage: { type: 'string', enum: ['allowed', 'context_only', 'prohibited'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const factSetResourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'workspaceId',
    'productId',
    'revisionNumber',
    'status',
    'createdByUserId',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workspaceId: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    revisionNumber: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: ['proposed', 'confirmed'] },
    summary: { type: ['string', 'null'], maxLength: 2048 },
    confirmedByUserId: { type: ['string', 'null'], format: 'uuid' },
    confirmedAt: { type: ['string', 'null'], format: 'date-time' },
    createdByUserId: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
  },
} as const;

export const factSetDetailResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['factSet', 'facts'],
  properties: {
    factSet: factSetResourceSchema,
    facts: { type: 'array', items: factResourceSchema },
  },
} as const;

export const listFactSetsRouteSchema = {
  tags: ['Catalog'],
  summary: 'List fact set revisions for product',
  description: 'Returns all proposed and confirmed fact set revisions for a product.',
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
    },
  },
  response: {
    200: {
      description: 'Paginated list of fact set revisions',
      type: 'object',
      additionalProperties: false,
      required: ['items', 'page'],
      properties: {
        items: { type: 'array', items: factSetResourceSchema },
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

export const createFactSetRouteSchema = {
  tags: ['Catalog'],
  summary: 'Create a proposed fact set',
  description: 'Creates a new proposed fact set with 1 to 100 immutable fact records.',
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
    required: ['facts'],
    properties: {
      summary: { type: ['string', 'null'], maxLength: 2048 },
      facts: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['factKey', 'valueText', 'sourceType', 'confidence', 'claimUsage'],
          properties: {
            factKey: { type: 'string', pattern: '^[a-z0-9]+([._-][a-z0-9]+)*$', maxLength: 128 },
            valueText: { type: 'string', minLength: 1, maxLength: 10000 },
            sourceType: { type: 'string', enum: ['user', 'merchant_page', 'document', 'other'] },
            sourceUrl: { type: ['string', 'null'], maxLength: 2048 },
            sourceExcerpt: { type: ['string', 'null'], maxLength: 2048 },
            confidence: { type: 'string', enum: ['confirmed', 'suggested', 'uncertain'] },
            claimUsage: { type: 'string', enum: ['allowed', 'context_only', 'prohibited'] },
          },
        },
      },
    },
  },
  response: {
    201: {
      description: 'Fact set created successfully',
      ...factSetDetailResponseSchema,
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
    409: { description: 'Conflict', ...problemDetailsJsonSchema },
    429: { description: 'Rate Limit Exceeded', ...problemDetailsJsonSchema },
  },
} as const;

export const getFactSetRouteSchema = {
  tags: ['Catalog'],
  summary: 'Get fact set and facts by ID',
  description: 'Retrieves a fact set revision and all associated facts.',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'productId', 'factSetId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      factSetId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      description: 'Fact set found',
      ...factSetDetailResponseSchema,
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
  },
} as const;

export const confirmFactSetRouteSchema = {
  tags: ['Catalog'],
  summary: 'Confirm a fact set revision',
  description:
    'Idempotently confirms a proposed fact set and sets it as the product current fact set.',
  headers: mutationHeadersSchema,
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'productId', 'factSetId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      factSetId: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: ['object', 'null'],
    additionalProperties: false,
  },
  response: {
    200: {
      description: 'Fact set confirmed successfully',
      type: 'object',
      additionalProperties: false,
      required: ['factSet', 'product', 'alreadyConfirmed'],
      properties: {
        factSet: factSetResourceSchema,
        product: productResourceSchema,
        alreadyConfirmed: { type: 'boolean' },
      },
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
    429: { description: 'Rate Limit Exceeded', ...problemDetailsJsonSchema },
  },
} as const;
