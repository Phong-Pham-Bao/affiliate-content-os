import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  idempotencyHeaderParam,
  originHeaderParam,
  sessionCookieParam,
  workspaceIdParam,
} from '../analysis/openapi-params.js';
import { acceptRevisionRouteSchema, rejectRevisionRouteSchema } from './schemas.js';

const artifactIdParam = {
  name: 'artifactId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: 'Unique identifier of the content artifact.',
} as const;

const revisionNumberQueryParam = {
  name: 'revisionNumber',
  in: 'query',
  required: false,
  schema: { type: 'integer', minimum: 1 },
  description:
    'Specific revision number to inspect. If omitted, returns compliance for the current revision.',
} as const;

export function buildOpenApiCompliancePaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}/compliance': {
      get: {
        summary: 'Get artifact compliance evaluation',
        description:
          'Returns the deterministic and AI advisory compliance evaluation for an artifact revision.',
        operationId: 'getArtifactCompliance',
        tags: ['Workforce'],
        parameters: [
          sessionCookieParam,
          workspaceIdParam,
          artifactIdParam,
          revisionNumberQueryParam,
        ],
        responses: {
          '200': {
            description: 'Compliance evaluation result',
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
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}/decisions': {
      get: {
        summary: 'List review decisions for an artifact',
        description: 'Returns the immutable human review decisions recorded for an artifact.',
        operationId: 'listArtifactDecisions',
        tags: ['Workforce'],
        parameters: [sessionCookieParam, workspaceIdParam, artifactIdParam],
        responses: {
          '200': {
            description: 'List of review decisions',
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
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}/accept': {
      post: {
        summary: 'Accept an artifact revision (Human only)',
        description:
          'Atomically accepts the exact current revision, creates an immutable approval snapshot, and completes the work order handoff state.',
        operationId: 'acceptArtifactRevision',
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
          content: { 'application/json': { schema: acceptRevisionRouteSchema.body } },
        },
        responses: {
          '200': {
            description: 'Artifact revision accepted successfully with approval snapshot',
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
            description: 'Version or revision conflict',
            headers: commonHeaders,
            content: problemDetailsContent,
          },
          '422': {
            description: 'Precondition failed - compliance has blocking findings',
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
    '/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}/reject': {
      post: {
        summary: 'Reject an artifact revision (Human only)',
        description:
          'Atomically rejects the exact current revision and records an immutable human review decision with reason.',
        operationId: 'rejectArtifactRevision',
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
          content: { 'application/json': { schema: rejectRevisionRouteSchema.body } },
        },
        responses: {
          '200': {
            description: 'Artifact revision rejected successfully',
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
            description: 'Version or revision conflict',
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
