import type { FastifySchema } from 'fastify';

export const socialAccountSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    workspaceId: { type: 'string', format: 'uuid' },
    platform: { type: 'string', enum: ['threads', 'tiktok'] },
    providerAccountId: { type: 'string' },
    displayName: { type: 'string' },
    handle: { type: ['string', 'null'] },
    status: {
      type: 'string',
      enum: ['connecting', 'active', 'degraded', 'reauth_required', 'review_gated', 'disconnected'],
    },
    grantedScopes: { type: 'array', items: { type: 'string' } },
    capabilities: {
      type: 'object',
      properties: {
        canPublishText: { type: 'boolean' },
        canPublishMedia: { type: 'boolean' },
        isBusinessAccount: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    capabilitiesCheckedAt: { type: ['string', 'null'], format: 'date-time' },
    tokenExpiresAt: { type: ['string', 'null'], format: 'date-time' },
    connectedByUserId: { type: 'string', format: 'uuid' },
    environment: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
  },
  required: [
    'id',
    'workspaceId',
    'platform',
    'providerAccountId',
    'displayName',
    'handle',
    'status',
    'grantedScopes',
    'capabilities',
    'capabilitiesCheckedAt',
    'connectedByUserId',
    'environment',
    'createdAt',
    'updatedAt',
    'version',
  ],
  additionalProperties: false,
} as const;

export const listSocialAccountsRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
    },
    required: ['workspaceId'],
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: socialAccountSchema,
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
};

export const authorizeSocialConnectionRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      platform: { type: 'string', enum: ['threads', 'tiktok'] },
    },
    required: ['workspaceId', 'platform'],
    additionalProperties: false,
  },
  headers: {
    type: 'object',
    required: ['origin', 'idempotency-key'],
    properties: {
      origin: { type: 'string', minLength: 1, maxLength: 2048 },
      'idempotency-key': { type: 'string', pattern: '^[!-~]{1,128}$' },
    },
  },
  body: {
    type: ['object', 'null'],
    properties: {
      returnTo: { type: 'string', maxLength: 512 },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        authorizationUrl: { type: 'string' },
        transactionId: { type: 'string', format: 'uuid' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
      required: ['authorizationUrl', 'transactionId', 'expiresAt'],
      additionalProperties: false,
    },
  },
};

export const socialCallbackRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: ['threads', 'tiktok'] },
    },
    required: ['platform'],
    additionalProperties: false,
  },
  querystring: {
    type: 'object',
    properties: {
      state: { type: 'string' },
      code: { type: 'string' },
      error: { type: 'string' },
      error_description: { type: 'string' },
    },
    required: ['state'],
    additionalProperties: true,
  },
};

export const getCallbackResultRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      resultKey: { type: 'string', minLength: 16, maxLength: 256 },
    },
    required: ['workspaceId', 'resultKey'],
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['success', 'failed'] },
        platform: { type: 'string', enum: ['threads', 'tiktok'] },
        socialAccountId: { type: ['string', 'null'] },
        errorCode: { type: ['string', 'null'] },
        errorDescription: { type: ['string', 'null'] },
      },
      required: ['id', 'status', 'platform', 'socialAccountId', 'errorCode', 'errorDescription'],
      additionalProperties: false,
    },
  },
};
