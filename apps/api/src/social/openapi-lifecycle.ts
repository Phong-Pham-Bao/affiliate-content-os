import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  disconnectSocialAccountRouteSchema,
  reconnectSocialAccountRouteSchema,
  refreshSocialAccountRouteSchema,
} from './schemas-lifecycle.js';

export function buildOpenApiSocialLifecyclePaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/social-accounts/{accountId}/reconnect': {
      post: {
        tags: ['Social Accounts'],
        summary: 'Reconnect existing social account',
        description:
          'Initiates OAuth reconnect flow bound to existing provider account ID. Owner only.',
        parameters: [
          {
            name: 'workspaceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'accountId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
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
              schema: reconnectSocialAccountRouteSchema.body,
            },
          },
        },
        responses: {
          '200': {
            description: 'Reconnect authorization URL generated.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (
                  reconnectSocialAccountRouteSchema.response as Record<string, unknown>
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
          '404': { description: 'Social account not found.', content: problemDetailsContent },
          '409': { description: 'Account mismatch or conflict.', content: problemDetailsContent },
          '503': {
            description: 'Social auth or platform disabled.',
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/social-accounts/{accountId}/refresh': {
      post: {
        tags: ['Social Accounts'],
        summary: 'Refresh social account token and capabilities',
        description: 'Performs token refresh and health synchronization. Owner only.',
        parameters: [
          {
            name: 'workspaceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'accountId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
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
        responses: {
          '200': {
            description: 'Social account refreshed successfully.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (refreshSocialAccountRouteSchema.response as Record<string, unknown>)[200],
              },
            },
          },
          '400': { description: 'Bad request.', content: problemDetailsContent },
          '401': { description: 'Authentication required.', content: problemDetailsContent },
          '403': { description: 'Owner capability required.', content: problemDetailsContent },
          '404': { description: 'Social account not found.', content: problemDetailsContent },
          '409': {
            description: 'Account disconnected or conflict.',
            content: problemDetailsContent,
          },
          '429': { description: 'Provider rate limit exceeded.', content: problemDetailsContent },
          '503': { description: 'Service or refresh disabled.', content: problemDetailsContent },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/social-accounts/{accountId}': {
      delete: {
        tags: ['Social Accounts'],
        summary: 'Disconnect social account',
        description:
          'Safely disconnects account and cryptographically erases credentials. Owner only.',
        parameters: [
          {
            name: 'workspaceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'accountId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'If-Match',
            in: 'header',
            required: false,
            schema: { type: 'string', maxLength: 32 },
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
              schema: disconnectSocialAccountRouteSchema.body,
            },
          },
        },
        responses: {
          '200': {
            description: 'Social account disconnected successfully.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (
                  disconnectSocialAccountRouteSchema.response as Record<string, unknown>
                )[200],
              },
            },
          },
          '400': { description: 'Bad request.', content: problemDetailsContent },
          '401': { description: 'Authentication required.', content: problemDetailsContent },
          '403': { description: 'Owner capability required.', content: problemDetailsContent },
          '404': { description: 'Social account not found.', content: problemDetailsContent },
          '409': { description: 'Account conflict.', content: problemDetailsContent },
          '412': {
            description: 'Precondition failed (version mismatch).',
            content: problemDetailsContent,
          },
          '503': { description: 'Service unavailable.', content: problemDetailsContent },
        },
      },
    },
  };
}
