import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  acceptAnalysisRouteSchema,
  rejectAnalysisRouteSchema,
  updateAIPolicyRouteSchema,
} from './schemas.js';
import {
  analysisIdParam,
  ifMatchHeaderParam,
  originHeaderParam,
  sessionCookieParam,
  workspaceIdParam,
} from './openapi-params.js';

export function buildOpenApiAnalysisReviewAndPolicyPaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/analyses/{analysisId}/accept': {
      post: {
        summary: 'Accept an analysis',
        description: 'Records human review acceptance of generated analysis.',
        operationId: 'acceptAnalysis',
        tags: ['Analysis'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          analysisIdParam,
          originHeaderParam,
          ifMatchHeaderParam,
        ],
        requestBody: {
          content: {
            'application/json': { schema: (acceptAnalysisRouteSchema as { body: unknown }).body },
          },
        },
        responses: {
          '200': {
            description: 'Analysis accepted.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (acceptAnalysisRouteSchema as { response: Record<number, unknown> })
                  .response[200],
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '404': {
            description: 'Not Found',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '409': {
            description: 'Conflict',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/analyses/{analysisId}/reject': {
      post: {
        summary: 'Reject an analysis',
        description: 'Records human review rejection of generated analysis with bounded reason.',
        operationId: 'rejectAnalysis',
        tags: ['Analysis'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          analysisIdParam,
          originHeaderParam,
          ifMatchHeaderParam,
        ],
        requestBody: {
          content: {
            'application/json': { schema: (rejectAnalysisRouteSchema as { body: unknown }).body },
          },
        },
        responses: {
          '200': {
            description: 'Analysis rejected.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (rejectAnalysisRouteSchema as { response: Record<number, unknown> })
                  .response[200],
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '404': {
            description: 'Not Found',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '409': {
            description: 'Conflict',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/ai-policy': {
      put: {
        summary: 'Update workspace AI policy (demo / admin)',
        description: 'Safely configures AI enablement and budget limit for local demonstration.',
        operationId: 'updateAIPolicy',
        tags: ['Analysis'],
        parameters: [sessionCookieParam, workspaceIdParam, originHeaderParam, ifMatchHeaderParam],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: (updateAIPolicyRouteSchema as { body: unknown }).body },
          },
        },
        responses: {
          '200': {
            description: 'Policy updated.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (updateAIPolicyRouteSchema as { response: Record<number, unknown> })
                  .response[200],
              },
            },
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
          '428': {
            description: 'Precondition Required',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
    },
  };
}
