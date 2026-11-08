import { parseUserId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import type {
  ContentArtifactDetailDTO,
  GetArtifactByIdQuery,
  WorkforceDependencies,
} from './types.js';

export async function getArtifactById(
  query: GetArtifactByIdQuery,
  deps: Pick<WorkforceDependencies, 'workforcePersistence' | 'workspaceAuthorization'>,
): Promise<ContentArtifactDetailDTO | null> {
  if (typeof query !== 'object' || query === null) {
    throw new ValidationError('Query must be an object', 'query');
  }

  const wsId = parseWorkspaceId(query.workspaceId);
  const actorId = parseUserId(query.actorUserId);
  if (!query.artifactId || typeof query.artifactId !== 'string') {
    throw new ValidationError('artifactId must be a string', 'artifactId');
  }

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.read' },
    { authorization: deps.workspaceAuthorization },
  );

  return deps.workforcePersistence.getArtifactById(wsId, query.artifactId);
}
