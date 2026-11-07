import {
  canWorkspaceRole,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type AnalysisSnapshot,
} from '@affiliate-content-os/domain';
import { ProductNotFoundError } from '../catalog/errors.js';
import { ValidationError, WorkspaceAccessDeniedError } from '../errors.js';
import type { PaginatedResult } from './ports.js';
import { decodeAnalysisCursor } from './cursor.js';
import type { ListAnalysesDependencies, ListAnalysesQuery } from './types.js';

export { type ListAnalysesDependencies, type ListAnalysesQuery };

export async function listAnalyses(
  query: ListAnalysesQuery,
  deps: ListAnalysesDependencies,
): Promise<PaginatedResult<AnalysisSnapshot>> {
  const wsId = parseWorkspaceId(query.workspaceId);
  const prodId = parseProductId(query.productId);
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

  const product = await deps.catalogPort.findProductById({
    workspaceId: wsId,
    productId: prodId,
  });
  if (!product) {
    throw new ProductNotFoundError(query.productId);
  }

  if (query.cursor !== undefined && query.cursor !== null) {
    decodeAnalysisCursor(query.cursor);
  }

  if (query.limit !== undefined && query.limit !== null) {
    if (
      typeof query.limit !== 'number' ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new ValidationError('limit must be an integer between 1 and 100', 'limit');
    }
  }

  return deps.analysisPort.listAnalyses(wsId, {
    productId: prodId,
    analysisType: query.analysisType,
    status: query.status,
    limit: query.limit,
    cursor: query.cursor,
  });
}
