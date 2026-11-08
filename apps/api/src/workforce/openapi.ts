import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  idempotencyHeaderParam,
  originHeaderParam,
  productIdParam,
  sessionCookieParam,
  workspaceIdParam,
} from '../analysis/openapi-params.js';
import { kickoffWorkOrderRouteSchema } from './schemas.js';

const workOrderIdParam = {
  name: 'workOrderId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the work order.',
} as const;

const artifactIdParam = {
  name: 'artifactId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the content artifact.',
} as const;

export function buildOpenApiWorkforcePaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/products/{productId}/work-orders': {
      post: {
        summary: 'Kick off an AI workforce launch campaign work order',
        description:
          'Enqueues workforce planning jobs and initial work items for autonomous execution.',
        operationId: 'kickoffWorkOrder',
        tags: ['Workforce'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          productIdParam,
          originHeaderParam,
          idempotencyHeaderParam,
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: kickoffWorkOrderRouteSchema.body } },
        },
        responses: {
          '201': {
            description: 'Work order successfully kicked off',
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
    },
    '/api/v1/workspaces/{workspaceId}/work-orders/{workOrderId}': {
      get: {
        summary: 'Get work order detail',
        description:
          'Returns full work order state including items, assignments, and dependencies.',
        operationId: 'getWorkOrder',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, workOrderIdParam],
        responses: {
          '200': {
            description: 'Work order details retrieved',
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
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/work-orders': {
      get: {
        summary: 'List work orders',
        description: 'Returns paginated work order summaries for the workspace.',
        operationId: 'listWorkOrders',
        tags: ['Workforce'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'productId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'List of work orders',
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
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/work-orders/{workOrderId}/artifacts': {
      get: {
        summary: 'List artifacts for a work order',
        description: 'Returns all content artifact summaries associated with the work order.',
        operationId: 'listWorkOrderArtifacts',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, workOrderIdParam],
        responses: {
          '200': {
            description: 'Artifact summaries retrieved',
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
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}': {
      get: {
        summary: 'Get artifact detail with latest revision',
        description: 'Returns artifact record, latest revision content, and evidence references.',
        operationId: 'getArtifactById',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, artifactIdParam],
        responses: {
          '200': {
            description: 'Artifact detail retrieved',
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
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/work-orders/{workOrderId}/activity': {
      get: {
        summary: 'List activity log for a work order',
        description: 'Returns recent audit and transition events for the work order.',
        operationId: 'listWorkOrderActivities',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, workOrderIdParam],
        responses: {
          '200': {
            description: 'Activity log retrieved',
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
        },
      },
    },
    '/api/v1/workspaces/{workspaceId}/work-orders/{workOrderId}/retry': {
      post: {
        summary: 'Retry failed planning items in a work order',
        description: 'Re-enqueues failed planning items after budget and policy verification.',
        operationId: 'retryWorkOrderPlanning',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, workOrderIdParam, originHeaderParam],
        responses: {
          '200': {
            description: 'Retry initiated successfully',
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
