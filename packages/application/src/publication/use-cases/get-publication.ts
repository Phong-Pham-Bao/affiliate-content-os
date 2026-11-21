import {
  parsePublicationId,
  parseUserId,
  parseWorkspaceId,
  PublicationNotFoundError,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../../ports.js';
import type { PublicationDetail, PublicationPersistencePort } from '../ports.js';

export interface GetPublicationQuery {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly publicationId: string;
}

export interface GetPublicationDependencies {
  readonly persistence: PublicationPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export async function getPublication(
  query: GetPublicationQuery,
  deps: GetPublicationDependencies,
): Promise<PublicationDetail> {
  const workspaceId = parseWorkspaceId(query.workspaceId);
  const actorUserId = parseUserId(query.actorUserId);
  const publicationId = parsePublicationId(query.publicationId);

  await authorizeWorkspaceAction(
    {
      workspaceId,
      userId: actorUserId,
      capability: 'publications.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const detail = await deps.persistence.findPublicationDetail(workspaceId, publicationId);
  if (!detail) {
    throw new PublicationNotFoundError(publicationId);
  }

  return detail;
}
