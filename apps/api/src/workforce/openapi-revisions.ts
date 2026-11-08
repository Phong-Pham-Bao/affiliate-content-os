import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  idempotencyHeaderParam,
  originHeaderParam,
  sessionCookieParam,
  workspaceIdParam,
} from '../analysis/openapi-params.js';
import { createManualRevisionRouteSchema, requestScriptChangesRouteSchema } from './schemas.js';

const artifactIdParam = {
  name: 'artifactId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the content artifact.',
} as const;

const revisionNumberParam = {
  name: 'revisionNumber',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'Revision number of the content artifact.',
} as const;

const changeRequestIdParam = {
  name: 'changeRequestId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the change request.',
} as const;

const changeRequestResponseSchema = {
  type: 'object',
  required: [
    'id',
    'artifactId',
    'baseRevisionNumber',
    'baseContentHashHex',
    'requestedByUserId',
    'instructionText',
    'selectedVideoNumbers',
    'targetVariantCount',
    'status',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    artifactId: { type: 'string', format: 'uuid' },
    baseRevisionNumber: { type: 'integer', minimum: 1 },
    baseContentHashHex: { type: 'string' },
    requestedByUserId: { type: 'string', format: 'uuid' },
    instructionText: { type: 'string' },
    selectedVideoNumbers: {
      type: 'array',
      items: { type: 'integer', minimum: 1, maximum: 5 },
    },
    targetVariantCount: { type: 'integer', minimum: 1, maximum: 3 },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'completed', 'failed', 'canceled'],
    },
    resultingRevisionNumber: { type: 'integer', minimum: 1, nullable: true },
    failureReason: { type: 'string', nullable: true },
    failureCode: {
      type: 'string',
      enum: [
        'stale_base_conflict',
        'provider_failure',
        'context_drift',
        'budget_exhausted',
        'timeout',
        'validation_failed',
      ],
      nullable: true,
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
} as const;

export function buildOpenApiRevisionPaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}/revisions': {
      get: {
        summary: 'List artifact revisions',
        description: 'Returns the immutable revision history for a content artifact.',
        operationId: 'getArtifactRevisions',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, artifactIdParam],
        responses: {
          '200': {
            description: 'List of artifact revisions',
            headers: commonHeaders,
            content: { 'application/json': { schema: { type: 'object' } } },
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
          '429': {
            description: 'Too Many Requests',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
      post: {
        summary: 'Create manual revision',
        description: 'Creates a new immutable revision from structured script package edits.',
        operationId: 'createManualRevision',
        tags: ['Workforce'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          artifactIdParam,
          originHeaderParam,
          idempotencyHeaderParam,
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: createManualRevisionRouteSchema.body } },
        },
        responses: {
          '201': {
            description: 'Manual revision created successfully',
            headers: commonHeaders,
            content: { 'application/json': { schema: { type: 'object' } } },
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
          '409': {
            description: 'Conflict',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '429': {
            description: 'Too Many Requests',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}/revisions/{revisionNumber}': {
      get: {
        summary: 'Get artifact revision by number',
        description: 'Returns a specific historical immutable revision of an artifact.',
        operationId: 'getArtifactRevisionByNumber',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, artifactIdParam, revisionNumberParam],
        responses: {
          '200': {
            description: 'Artifact revision details',
            headers: commonHeaders,
            content: { 'application/json': { schema: { type: 'object' } } },
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
            description: 'Too Many Requests',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}/request-changes': {
      post: {
        summary: 'Request changes on script package',
        description:
          'Enqueues targeted AI regeneration for selected video numbers against an exact base revision.',
        operationId: 'requestScriptChanges',
        tags: ['Workforce'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          artifactIdParam,
          originHeaderParam,
          idempotencyHeaderParam,
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: requestScriptChangesRouteSchema.body } },
        },
        responses: {
          '202': {
            description: 'Change request accepted and units enqueued',
            headers: commonHeaders,
            content: { 'application/json': { schema: changeRequestResponseSchema } },
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
          '409': {
            description: 'Conflict',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '429': {
            description: 'Too Many Requests',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}/change-requests/{changeRequestId}': {
      get: {
        summary: 'Get change request status',
        description: 'Polls the status of an ongoing or completed change request.',
        operationId: 'getChangeRequestById',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, artifactIdParam, changeRequestIdParam],
        responses: {
          '200': {
            description: 'Change request status details',
            headers: commonHeaders,
            content: { 'application/json': { schema: changeRequestResponseSchema } },
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
            description: 'Too Many Requests',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
  };
}
