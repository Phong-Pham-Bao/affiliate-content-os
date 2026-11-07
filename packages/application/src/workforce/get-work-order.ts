import { parseUserId, parseWorkOrderId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import type { GetWorkOrderQuery, WorkOrderDetailDTO, WorkforceDependencies } from './types.js';

export async function getWorkOrder(
  query: GetWorkOrderQuery,
  deps: Pick<WorkforceDependencies, 'workforcePersistence' | 'workspaceAuthorization'>,
): Promise<WorkOrderDetailDTO | null> {
  if (typeof query !== 'object' || query === null) {
    throw new ValidationError('Query must be an object', 'query');
  }

  const wsId = parseWorkspaceId(query.workspaceId);
  const orderId = parseWorkOrderId(query.workOrderId);
  const actorId = parseUserId(query.actorUserId);

  // Active membership required
  await authorizeWorkspaceAction(
    {
      workspaceId: wsId,
      userId: actorId,
      capability: 'catalog.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  return deps.workforcePersistence.getWorkOrderById(wsId, orderId);
}
