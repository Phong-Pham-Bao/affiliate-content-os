import { commonHeaders, problemDetailsContent } from '../auth/openapi-auth-paths.js';
import {
  cursorQueryParam,
  limitQueryParam,
  platformQueryParam,
  publicationIdParam,
  sessionCookieParam,
  socialAccountIdQueryParam,
  statusQueryParam,
  workspaceIdParam,
} from './openapi-params.js';
import { publicationDetailSchema, publicationListSchema } from './schemas.js';

export function buildListPublicationsPath(): Record<string, unknown> {
  return {
    tags: ['Publications'],
    summary: 'List publications in workspace',
    description:
      'Returns cursor-paginated publications filtered by status, platform, or social account. Requires publications.read.',
    parameters: [
      sessionCookieParam,
      workspaceIdParam,
      limitQueryParam,
      cursorQueryParam,
      statusQueryParam,
      socialAccountIdQueryParam,
      platformQueryParam,
    ],
    responses: {
      '200': {
        description: 'Paginated list of publications in workspace.',
        headers: commonHeaders,
        content: {
          'application/json': {
            schema: publicationListSchema,
          },
        },
      },
      '400': {
        description: 'Malformed query parameters or headers.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '401': {
        description: 'Authentication required.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '403': {
        description: 'Access denied to workspace.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '404': {
        description: 'Workspace not found.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '429': {
        description: 'Publication read rate limit exceeded.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '503': {
        description: 'Service unavailable.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
    },
  };
}

export function buildGetPublicationPath(): Record<string, unknown> {
  return {
    tags: ['Publications'],
    summary: 'Get publication detail',
    description:
      'Returns publication state, destination display facts, approval snapshot summary, and attempt history. Requires publications.read.',
    parameters: [sessionCookieParam, workspaceIdParam, publicationIdParam],
    responses: {
      '200': {
        description:
          'Publication detail including destination, approval snapshot, and attempt history.',
        headers: commonHeaders,
        content: {
          'application/json': {
            schema: publicationDetailSchema,
          },
        },
      },
      '400': {
        description: 'Malformed parameters or headers.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '401': {
        description: 'Authentication required.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '403': {
        description: 'Access denied to workspace.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '404': {
        description: 'Workspace or publication not found.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '429': {
        description: 'Publication read rate limit exceeded.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
      '503': {
        description: 'Service unavailable.',
        headers: commonHeaders,
        content: problemDetailsContent,
      },
    },
  };
}
