import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import { buildOpenApiSocialLifecyclePaths } from './openapi-lifecycle.js';
import {
  authorizeSocialConnectionRouteSchema,
  getCallbackResultRouteSchema,
  listSocialAccountsRouteSchema,
} from './schemas.js';

export function buildOpenApiSocialPaths(): Record<string, unknown> {
  return {
    ...buildOpenApiSocialLifecyclePaths(),
    '/api/v1/workspaces/{workspaceId}/social-accounts': {
      get: {
        tags: ['Social Accounts'],
        summary: 'List social accounts in workspace',
        description: 'Returns safe social account records without credential secrets.',
        parameters: [
          {
            name: 'workspaceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'acos_session',
            in: 'cookie',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'List of connected social accounts.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (listSocialAccountsRouteSchema.response as Record<string, unknown>)[200],
              },
            },
          },
          '401': { description: 'Authentication required.', content: problemDetailsContent },
          '403': { description: 'Access denied to workspace.', content: problemDetailsContent },
          '404': { description: 'Workspace not found.', content: problemDetailsContent },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/social-connections/{platform}/authorize': {
      post: {
        tags: ['Social Connections'],
        summary: 'Initiate OAuth authorization for social platform',
        description: 'Generates authorization URL and atomic pending transaction. Owner only.',
        parameters: [
          {
            name: 'workspaceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'platform',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['threads', 'tiktok'] },
          },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', pattern: '^[!-~]{1,128}$' },
          },
          {
            name: 'Origin',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'acos_session',
            in: 'cookie',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: authorizeSocialConnectionRouteSchema.body,
            },
          },
        },
        responses: {
          '200': {
            description: 'OAuth authorization URL generated.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (
                  authorizeSocialConnectionRouteSchema.response as Record<string, unknown>
                )[200],
              },
            },
          },
          '400': {
            description: 'Bad request or unsupported platform.',
            content: problemDetailsContent,
          },
          '401': { description: 'Authentication required.', content: problemDetailsContent },
          '403': { description: 'Owner capability required.', content: problemDetailsContent },
          '409': { description: 'Idempotency conflict.', content: problemDetailsContent },
          '503': { description: 'Social auth not configured.', content: problemDetailsContent },
        },
      },
    },
    '/api/v1/social-connections/{platform}/callback': {
      get: {
        tags: ['Social Connections'],
        summary: 'OAuth redirect callback from social platform',
        description: 'Exchanges code for credentials, persists account atomically, and redirects.',
        parameters: [
          {
            name: 'platform',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['threads', 'tiktok'] },
          },
          {
            name: 'state',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'code',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'error',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'error_description',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '302': {
            description: 'Redirects to returnTo URL with connection_result key.',
            headers: {
              Location: {
                schema: { type: 'string', format: 'uri' },
                description: 'Client return URI with opaque connection_result parameter.',
              },
              ...commonHeaders,
            },
          },
          '400': { description: 'Invalid callback parameters.', content: problemDetailsContent },
          '404': { description: 'Transaction not found.', content: problemDetailsContent },
          '409': { description: 'Transaction already replayed.', content: problemDetailsContent },
          '410': { description: 'Transaction expired.', content: problemDetailsContent },
          '502': { description: 'Provider code exchange failed.', content: problemDetailsContent },
          '503': { description: 'Social auth not configured.', content: problemDetailsContent },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/social-connections/callback-results/{resultKey}': {
      get: {
        tags: ['Social Connections'],
        summary: 'Consume social connection callback result',
        description: 'Single-use consumption of callback result after OAuth redirect.',
        parameters: [
          {
            name: 'workspaceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'resultKey',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'acos_session',
            in: 'cookie',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Callback result consumed.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (getCallbackResultRouteSchema.response as Record<string, unknown>)[200],
              },
            },
          },
          '401': { description: 'Authentication required.', content: problemDetailsContent },
          '403': { description: 'Access denied to workspace.', content: problemDetailsContent },
          '404': { description: 'Callback result not found.', content: problemDetailsContent },
          '410': {
            description: 'Callback result expired or already consumed.',
            content: problemDetailsContent,
          },
        },
      },
    },
  };
}
