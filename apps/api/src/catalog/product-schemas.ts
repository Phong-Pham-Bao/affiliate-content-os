import { problemDetailsJsonSchema } from '../auth/schemas.js';

export const mutationHeadersSchema = {
  type: 'object',
  required: ['origin'],
  properties: {
    origin: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;

export const createHeadersSchema = {
  type: 'object',
  required: ['origin', 'idempotency-key'],
  properties: {
    origin: { type: 'string', minLength: 1, maxLength: 2048 },
    'idempotency-key': { type: 'string', pattern: '^[!-~]{1,128}$' },
  },
} as const;

export const updateHeadersSchema = {
  type: 'object',
  required: ['origin', 'if-match'],
  properties: {
    origin: { type: 'string', minLength: 1, maxLength: 2048 },
    'if-match': { type: 'string', pattern: '^"[1-9][0-9]*"$' },
  },
} as const;

export const productResourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'workspaceId',
    'name',
    'merchantName',
    'canonicalUrl',
    'category',
    'description',
    'status',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workspaceId: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 256 },
    merchantName: { type: 'string', minLength: 1, maxLength: 256 },
    canonicalUrl: { type: 'string', maxLength: 2048 },
    category: { type: 'string', minLength: 1, maxLength: 128 },
    description: { type: 'string', minLength: 1, maxLength: 10000 },
    audienceNotes: { type: ['string', 'null'], maxLength: 5000 },
    allowedClaimsNotes: { type: ['string', 'null'], maxLength: 5000 },
    prohibitedClaimsNotes: { type: ['string', 'null'], maxLength: 5000 },
    status: { type: 'string', enum: ['draft', 'active', 'archived'] },
    currentFactSetId: { type: ['string', 'null'], format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
    duplicateWarning: { type: 'boolean' },
    alreadyArchived: { type: 'boolean' },
  },
} as const;

export const listProductsRouteSchema = {
  tags: ['Catalog'],
  summary: 'List products in workspace',
  description: 'Returns paginated products filtered by optional status for the workspace.',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      after: { type: 'string', maxLength: 512 },
      status: { type: 'string', enum: ['draft', 'active', 'archived'] },
    },
  },
  response: {
    200: {
      description: 'Paginated list of products',
      type: 'object',
      additionalProperties: false,
      required: ['items', 'page'],
      properties: {
        items: { type: 'array', items: productResourceSchema },
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
    404: { description: 'Workspace Not Found', ...problemDetailsJsonSchema },
  },
} as const;

export const createProductRouteSchema = {
  tags: ['Catalog'],
  summary: 'Create a draft product',
  description:
    'Creates a new draft product in the workspace with duplicate URL check and idempotency protection.',
  headers: createHeadersSchema,
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'merchantName', 'canonicalUrl', 'category', 'description'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 256 },
      merchantName: { type: 'string', minLength: 1, maxLength: 256 },
      canonicalUrl: { type: 'string', minLength: 1, maxLength: 2048 },
      category: { type: 'string', minLength: 1, maxLength: 128 },
      description: { type: 'string', minLength: 1, maxLength: 10000 },
      audienceNotes: { type: ['string', 'null'], maxLength: 5000 },
      allowedClaimsNotes: { type: ['string', 'null'], maxLength: 5000 },
      prohibitedClaimsNotes: { type: ['string', 'null'], maxLength: 5000 },
      status: { type: 'string', enum: ['draft'] },
    },
  },
  response: {
    201: {
      description: 'Product created successfully',
      ...productResourceSchema,
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Workspace Not Found', ...problemDetailsJsonSchema },
    409: { description: 'Conflict', ...problemDetailsJsonSchema },
    429: { description: 'Rate Limit Exceeded', ...problemDetailsJsonSchema },
  },
} as const;

export const getProductRouteSchema = {
  tags: ['Catalog'],
  summary: 'Get product by ID',
  description: 'Returns product details if accessible by the caller.',
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'productId'],
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      description: 'Product found',
      ...productResourceSchema,
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
  },
} as const;

export const updateProductRouteSchema = {
  tags: ['Catalog'],
  summary: 'Update product',
  description: 'Versioned product update requiring If-Match header.',
  headers: updateHeadersSchema,
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
    minProperties: 1,
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 256 },
      merchantName: { type: 'string', minLength: 1, maxLength: 256 },
      canonicalUrl: { type: 'string', minLength: 1, maxLength: 2048 },
      category: { type: 'string', minLength: 1, maxLength: 128 },
      description: { type: 'string', minLength: 1, maxLength: 10000 },
      audienceNotes: { type: ['string', 'null'], maxLength: 5000 },
      allowedClaimsNotes: { type: ['string', 'null'], maxLength: 5000 },
      prohibitedClaimsNotes: { type: ['string', 'null'], maxLength: 5000 },
      status: { type: 'string', enum: ['draft', 'active'] },
    },
  },
  response: {
    200: {
      description: 'Product updated successfully',
      ...productResourceSchema,
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

export const archiveProductRouteSchema = {
  tags: ['Catalog'],
  summary: 'Archive product',
  description: 'Idempotently archives a product in the workspace.',
  headers: mutationHeadersSchema,
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
    type: ['object', 'null'],
    additionalProperties: false,
  },
  response: {
    200: {
      description: 'Product archived successfully',
      ...productResourceSchema,
    },
    400: { description: 'Bad Request', ...problemDetailsJsonSchema },
    401: { description: 'Unauthorized', ...problemDetailsJsonSchema },
    403: { description: 'Forbidden', ...problemDetailsJsonSchema },
    404: { description: 'Not Found', ...problemDetailsJsonSchema },
    429: { description: 'Rate Limit Exceeded', ...problemDetailsJsonSchema },
  },
} as const;
