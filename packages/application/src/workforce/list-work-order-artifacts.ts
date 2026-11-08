import { parseUserId, parseWorkOrderId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import type {
  ContentArtifactSummaryDTO,
  ListWorkOrderArtifactsQuery,
  WorkforceDependencies,
} from './types.js';

export async function listWorkOrderArtifacts(
  query: ListWorkOrderArtifactsQuery,
  deps: Pick<WorkforceDependencies, 'workforcePersistence' | 'workspaceAuthorization'>,
): Promise<readonly ContentArtifactSummaryDTO[]> {
  if (typeof query !== 'object' || query === null) {
    throw new ValidationError('Query must be an object', 'query');
  }

  const wsId = parseWorkspaceId(query.workspaceId);
  const orderId = parseWorkOrderId(query.workOrderId);
  const actorId = parseUserId(query.actorUserId);

  await authorizeWorkspaceAction(
    { workspaceId: wsId, userId: actorId, capability: 'catalog.read' },
    { authorization: deps.workspaceAuthorization },
  );

  return deps.workforcePersistence.listWorkOrderArtifacts(wsId, orderId);
}
