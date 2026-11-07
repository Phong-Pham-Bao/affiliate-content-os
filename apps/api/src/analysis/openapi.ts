import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  enqueueAnalysisRouteSchema,
  getAnalysisRouteSchema,
  getOperationRouteSchema,
  listAnalysesRouteSchema,
} from './schemas.js';
import {
  analysisIdParam,
  idempotencyHeaderParam,
  operationIdParam,
  originHeaderParam,
  productIdParam,
  sessionCookieParam,
  workspaceIdParam,
} from './openapi-params.js';
import { buildOpenApiAnalysisReviewAndPolicyPaths } from './openapi-review-paths.js';

export function buildOpenApiAnalysisPaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/products/{productId}/analyses': {
      post: {
        summary: 'Request asynchronous AI product or niche analysis',
        description: 'Enqueues analysis job and returns 202 Accepted with operation location.',
        operationId: 'enqueueAnalysis',
        tags: ['Analysis'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          productIdParam,
          originHeaderParam,
          idempotencyHeaderParam,
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: (enqueueAnalysisRouteSchema as { body: unknown }).body },
          },
        },
        responses: {
          '202': {
            description: 'Analysis request accepted and queued.',
            headers: {
              ...commonHeaders,
              Location: {
                schema: { type: 'string' },
                description: 'Location of the operation resource.',
              },
            },
            content: {
              'application/json': {
                schema: (enqueueAnalysisRouteSchema as { response: Record<number, unknown> })
                  .response[202],
              },
            },
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
          '429': {
            description: 'Too Many Requests',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
        },
      },
      get: {
        summary: 'List analyses for a product',
        description: 'Returns paginated analyses for a product.',
        operationId: 'listAnalyses',
        tags: ['Analysis'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          productIdParam,
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string', enum: ['product', 'niche', 'performance'] },
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['generated', 'accepted', 'rejected'] },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': {
            description: 'Paginated list of analyses.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (listAnalysesRouteSchema as { response: Record<number, unknown> })
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
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/analyses/{analysisId}': {
      get: {
        summary: 'Get analysis by ID',
        description:
          'Returns single immutable analysis with structured content and safe model provenance.',
        operationId: 'getAnalysis',
        tags: ['Analysis'],
        parameters: [sessionCookieParam, workspaceIdParam, analysisIdParam],
        responses: {
          '200': {
            description: 'Analysis details.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (getAnalysisRouteSchema as { response: Record<number, unknown> })
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
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/operations/{operationId}': {
      get: {
        summary: 'Get operation status',
        description:
          'Returns asynchronous operation progress, terminal status, or failure category.',
        operationId: 'getOperation',
        tags: ['Analysis'],
        parameters: [sessionCookieParam, workspaceIdParam, operationIdParam],
        responses: {
          '200': {
            description: 'Operation status.',
            headers: commonHeaders,
            content: {
              'application/json': {
                schema: (getOperationRouteSchema as { response: Record<number, unknown> })
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
        },
      },
    },
    ...buildOpenApiAnalysisReviewAndPolicyPaths(),
  };
}
