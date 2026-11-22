import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  idempotencyHeaderParam,
  originHeaderParam,
  sessionCookieParam,
  workspaceIdParam,
} from './openapi-params.js';
import {
  createPublicationApprovalRouteSchema,
  publicationApprovalSnapshotSchema,
} from './schemas.js';

export function buildCreatePublicationApprovalPath(): Record<string, unknown> {
  return {
    tags: ['Publications'],
    summary: 'Create immutable destination publication approval snapshot',
    description:
      'Derives and freezes destination publication approval from accepted content approval snapshot. Requires content.approve and publications.manage.',
    parameters: [sessionCookieParam, workspaceIdParam, originHeaderParam, idempotencyHeaderParam],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: createPublicationApprovalRouteSchema.body,
        },
      },
    },
    responses: {
      '201': {
        description: 'Destination publication approval snapshot created or idempotent replay.',
        headers: commonHeaders,
        content: {
          'application/json': {
            schema: publicationApprovalSnapshotSchema,
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
        description: 'Workspace, source content approval, or destination social account not found.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '409': {
        description: 'Idempotency key payload conflict or concurrent state change.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '422': {
        description:
          'Prerequisites drifted, preview hash mismatch, or compliance/capability gating failure.',
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
