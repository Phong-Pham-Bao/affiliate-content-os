import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  idempotencyHeaderParam,
  originHeaderParam,
  sessionCookieParam,
  workspaceIdParam,
} from './openapi-params.js';
import { createPublicationScheduleRouteSchema, publicationSchema } from './schemas.js';

export function buildCreatePublicationSchedulePath(): Record<string, unknown> {
  return {
    tags: ['Publications'],
    summary: 'Schedule publication from destination approval snapshot',
    description:
      'Creates a scheduled publication with exact timezone triple from an approved snapshot. Human editor/owner only. Returns 201 scheduled without inline publishing.',
    parameters: [sessionCookieParam, workspaceIdParam, originHeaderParam, idempotencyHeaderParam],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: createPublicationScheduleRouteSchema.body,
        },
      },
    },
    responses: {
      '201': {
        description: 'Publication scheduled successfully or idempotent replay.',
        headers: commonHeaders,
        content: {
          'application/json': {
            schema: publicationSchema,
          },
        },
      },
      '400': {
        description: 'Malformed request payload, headers, or parameters.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '401': {
        description: 'Authentication required.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '403': {
        description: 'Insufficient permissions or invalid origin.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '404': {
        description: 'Workspace or destination publication approval snapshot not found.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '409': {
        description:
          'Publication already scheduled for this snapshot, version conflict, or idempotency conflict.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '422': {
        description: 'Invalid schedule timing, drift, or gating failure.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '429': {
        description: 'Publication mutation rate limit exceeded.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '503': {
        description: 'Social platform kill switch active or service unavailable.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
    },
  };
}
