import { commonHeaders, problemDetailsContent } from './openapi-auth-paths.js';
import { logoutRouteSchema, meRouteSchema } from './schemas.js';

export function buildOpenApiApiPaths(): Record<string, unknown> {
  return {
    '/api/v1/me': {
      get: {
        tags: meRouteSchema.tags,
        summary: meRouteSchema.summary,
        description: meRouteSchema.description,
        parameters: [
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
            description: 'Current user, active session, and accessible workspaces.',
            headers: {
              'Set-Cookie': {
                schema: { type: 'string' },
                description: 'Refreshed session cookie when rotation occurs.',
              },
              ...commonHeaders,
            },
            content: {
              'application/json': {
                schema: meRouteSchema.response[200],
              },
            },
          },
          '401': {
            description: 'Session cookie missing, invalid, expired, or revoked.',
            headers: {
              'Set-Cookie': {
                schema: { type: 'string' },
                description: 'Clears acos_session cookie.',
              },
              ...commonHeaders,
            },
            content: problemDetailsContent,
          },
          '503': {
            description: 'Authentication disabled.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/logout': {
      post: {
        tags: logoutRouteSchema.tags,
        summary: logoutRouteSchema.summary,
        description: logoutRouteSchema.description,
        parameters: [
          {
            name: 'Origin',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Request origin validated against application base URL.',
          },
          {
            name: 'acos_session',
            in: 'cookie',
            required: false,
            schema: { type: 'string' },
            description: 'Session cookie to revoke.',
          },
        ],
        responses: {
          '204': {
            description: 'Session revoked successfully.',
            headers: {
              'Set-Cookie': {
                schema: { type: 'string' },
                description: 'Clears acos_session cookie.',
              },
              ...commonHeaders,
            },
          },
          '400': {
            description: 'Unexpected request body or query parameters.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '403': {
            description: 'Request origin is invalid or untrusted.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '503': {
            description: 'Authentication disabled.',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
  };
}
