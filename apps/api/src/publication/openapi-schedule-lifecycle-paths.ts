import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  idempotencyHeaderParam,
  originHeaderParam,
  publicationIdParam,
  sessionCookieParam,
  workspaceIdParam,
} from './openapi-params.js';
import {
  cancelPublicationRouteSchema,
  publicationSchema,
  reschedulePublicationRouteSchema,
} from './schemas.js';

export function buildReschedulePublicationPath(): Record<string, unknown> {
  return {
    tags: ['Publications'],
    summary: 'Reschedule publication',
    description:
      'Updates publication schedule before execution claim. Requires expected version, publications.manage, and Idempotency-Key.',
    parameters: [
      sessionCookieParam,
      workspaceIdParam,
      publicationIdParam,
      originHeaderParam,
      idempotencyHeaderParam,
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: reschedulePublicationRouteSchema.body,
        },
      },
    },
    responses: {
      '200': {
        description: 'Publication rescheduled successfully or idempotent replay.',
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
        description: 'Workspace or publication not found.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '409': {
        description:
          'State conflict, expected version mismatch, active lease, or idempotency conflict.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '422': {
        description: 'Invalid schedule timing, drift, or unprocessable publication state.',
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

export function buildCancelPublicationPath(): Record<string, unknown> {
  return {
    tags: ['Publications'],
    summary: 'Cancel scheduled publication',
    description:
      'Cancels a scheduled or queued publication before execution starts. Requires expected version, publications.manage, and Idempotency-Key.',
    parameters: [
      sessionCookieParam,
      workspaceIdParam,
      publicationIdParam,
      originHeaderParam,
      idempotencyHeaderParam,
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: cancelPublicationRouteSchema.body,
        },
      },
    },
    responses: {
      '200': {
        description: 'Publication canceled successfully or idempotent replay.',
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
        description: 'Workspace or publication not found.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '409': {
        description:
          'State conflict, expected version mismatch, execution already started, or idempotency conflict.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '422': {
        description: 'Unprocessable publication state for cancellation.',
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
