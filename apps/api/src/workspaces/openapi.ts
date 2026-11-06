import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  createWorkspaceRouteSchema,
  getWorkspaceRouteSchema,
  workspaceResourceSchema,
} from './schemas.js';

export function buildOpenApiWorkspacePaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces': {
      post: {
        tags: createWorkspaceRouteSchema.tags,
        summary: createWorkspaceRouteSchema.summary,
        description: createWorkspaceRouteSchema.description,
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: {
              type: 'string',
              pattern: '^[!-~]{1,128}$',
            },
            description: 'Mandatory idempotency key for safe duplicate prevention.',
          },
          {
            name: 'Origin',
            in: 'header',
            required: true,
            schema: {
              type: 'string',
              minLength: 1,
              maxLength: 2048,
            },
            description: 'Request origin validated against application base URL.',
          },
          {
            name: 'acos_session',
            in: 'cookie',
            required: true,
            schema: { type: 'string' },
            description: 'Opaque application session token.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: createWorkspaceRouteSchema.body,
            },
          },
        },
        responses: {
          '201': {
            description: createWorkspaceRouteSchema.response[201].description,
            headers: {
              Location: {
                schema: { type: 'string' },
                description: 'URI of the newly created workspace resource.',
              },
              ...commonHeaders,
            },
            content: {
              'application/json': {
                schema: workspaceResourceSchema,
              },
            },
          },
          '400': {
            description: createWorkspaceRouteSchema.response[400].description,
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '401': {
            description: createWorkspaceRouteSchema.response[401].description,
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '403': {
            description: createWorkspaceRouteSchema.response[403].description,
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '409': {
            description: createWorkspaceRouteSchema.response[409].description,
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '429': {
            description: createWorkspaceRouteSchema.response[429].description,
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}': {
      get: {
        tags: getWorkspaceRouteSchema.tags,
        summary: getWorkspaceRouteSchema.summary,
        description: getWorkspaceRouteSchema.description,
        parameters: [
          {
            name: 'workspaceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Canonical UUIDv7 identifier of the workspace.',
          },
          {
            name: 'acos_session',
            in: 'cookie',
            required: true,
            schema: { type: 'string' },
            description: 'Opaque application session token.',
          },
        ],
        responses: {
          '200': {
            description: getWorkspaceRouteSchema.response[200].description,
            headers: {
              ETag: {
                schema: { type: 'string' },
                description: 'Resource version ETag.',
              },
              ...commonHeaders,
            },
            content: {
              'application/json': {
                schema: workspaceResourceSchema,
              },
            },
          },
          '400': {
            description: getWorkspaceRouteSchema.response[400].description,
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '401': {
            description: getWorkspaceRouteSchema.response[401].description,
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '404': {
            description: getWorkspaceRouteSchema.response[404].description,
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
  };
}
