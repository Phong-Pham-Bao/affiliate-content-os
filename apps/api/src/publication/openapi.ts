import { buildCreatePublicationApprovalPath } from './openapi-approval-paths.js';
import { buildCreatePublicationSchedulePath } from './openapi-schedule-creation-paths.js';
import {
  buildCancelPublicationPath,
  buildReschedulePublicationPath,
} from './openapi-schedule-lifecycle-paths.js';
import { buildGetPublicationPath, buildListPublicationsPath } from './openapi-read-paths.js';

export { buildOpenApiPublicationComponents } from './openapi-params.js';

export function buildOpenApiPublicationPaths(): Record<string, unknown> {
  return {
    '/api/v1/workspaces/{workspaceId}/publication-approvals': {
      post: buildCreatePublicationApprovalPath(),
    },
    '/api/v1/workspaces/{workspaceId}/publications': {
      post: buildCreatePublicationSchedulePath(),
      get: buildListPublicationsPath(),
    },
    '/api/v1/workspaces/{workspaceId}/publications/{publicationId}': {
      get: buildGetPublicationPath(),
      patch: buildReschedulePublicationPath(),
    },
    '/api/v1/workspaces/{workspaceId}/publications/{publicationId}/cancel': {
      post: buildCancelPublicationPath(),
    },
  };
}
