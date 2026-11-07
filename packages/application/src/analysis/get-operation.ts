import {
  canWorkspaceRole,
  parseOperationId,
  parseUserId,
  parseWorkspaceId,
  type OperationSnapshot,
} from '@affiliate-content-os/domain';
import { OperationNotFoundError } from './errors.js';
import { WorkspaceAccessDeniedError } from '../errors.js';
import type { GetOperationDependencies, GetOperationQuery } from './types.js';

export { type GetOperationDependencies, type GetOperationQuery };

export async function getOperation(
  query: GetOperationQuery,
  deps: GetOperationDependencies,
): Promise<OperationSnapshot> {
  const wsId = parseWorkspaceId(query.workspaceId);
  const opId = parseOperationId(query.operationId);
  const actorId = parseUserId(query.actorUserId);

  const membership = await deps.authPort.findMembership({
    workspaceId: wsId,
    userId: actorId,
  });
  if (!membership || membership.status !== 'active') {
    throw new WorkspaceAccessDeniedError();
  }
  if (!canWorkspaceRole(membership.role, 'catalog.read')) {
    throw new WorkspaceAccessDeniedError();
  }

  const operation = await deps.operationPort.getOperationById(wsId, opId);
  if (!operation) {
    throw new OperationNotFoundError(query.operationId);
  }

  return operation;
}
