import { parseUserId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../../authorize-workspace-action.js';
import { ValidationError } from '../../errors.js';
import type { WorkspaceAuthorizationPort } from '../../ports.js';
import type {
  ListPublicationsOptions,
  PaginatedPublications,
  PublicationPersistencePort,
} from '../ports.js';

export interface ListPublicationsQuery {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly options: ListPublicationsOptions;
}

export interface ListPublicationsDependencies {
  readonly persistence: PublicationPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export async function listPublications(
  query: ListPublicationsQuery,
  deps: ListPublicationsDependencies,
): Promise<PaginatedPublications> {
  const workspaceId = parseWorkspaceId(query.workspaceId);
  const actorUserId = parseUserId(query.actorUserId);

  await authorizeWorkspaceAction(
    {
      workspaceId,
      userId: actorUserId,
      capability: 'publications.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  if (query.options.limit !== undefined && query.options.limit !== null) {
    if (
      typeof query.options.limit !== 'number' ||
      !Number.isSafeInteger(query.options.limit) ||
      query.options.limit < 1 ||
      query.options.limit > 100
    ) {
      throw new ValidationError('limit must be an integer between 1 and 100', 'limit');
    }
  }

  return deps.persistence.listPublications(workspaceId, query.options);
}
