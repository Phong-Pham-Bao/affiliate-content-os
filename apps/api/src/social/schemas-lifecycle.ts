import type { FastifySchema } from 'fastify';
import { socialAccountSchema } from './schemas.js';

export const reconnectSocialAccountRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      accountId: { type: 'string', format: 'uuid' },
    },
    required: ['workspaceId', 'accountId'],
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

export const refreshSocialAccountRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      accountId: { type: 'string', format: 'uuid' },
    },
    required: ['workspaceId', 'accountId'],
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
  response: {
    200: socialAccountSchema,
  },
};

export const disconnectSocialAccountRouteSchema: FastifySchema = {
  params: {
    type: 'object',
    properties: {
      workspaceId: { type: 'string', format: 'uuid' },
      accountId: { type: 'string', format: 'uuid' },
    },
    required: ['workspaceId', 'accountId'],
    additionalProperties: false,
  },
  headers: {
    type: 'object',
    required: ['origin', 'idempotency-key'],
    properties: {
      origin: { type: 'string', minLength: 1, maxLength: 2048 },
      'idempotency-key': { type: 'string', pattern: '^[!-~]{1,128}$' },
      'if-match': { type: 'string', maxLength: 32 },
    },
  },
  body: {
    type: ['object', 'null'],
    properties: {
      expectedVersion: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  },
  response: {
    200: socialAccountSchema,
  },
};
