import { parseProductId, parseUserId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import {
  decodeWorkOrderCursor,
  encodeWorkOrderCursor,
  type DecodedWorkOrderCursor,
} from './cursor.js';
import type { ListWorkOrdersQuery, ListWorkOrdersResult, WorkforceDependencies } from './types.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listWorkOrders(
  query: ListWorkOrdersQuery,
  deps: Pick<WorkforceDependencies, 'workforcePersistence' | 'workspaceAuthorization'>,
): Promise<ListWorkOrdersResult> {
  if (typeof query !== 'object' || query === null) {
    throw new ValidationError('Query must be an object', 'query');
  }

  const wsId = parseWorkspaceId(query.workspaceId);
  const actorId = parseUserId(query.actorUserId);

  await authorizeWorkspaceAction(
    {
      workspaceId: wsId,
      userId: actorId,
      capability: 'catalog.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== null) {
    if (
      typeof query.limit !== 'number' ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > MAX_LIMIT
    ) {
      throw new ValidationError(`Limit must be an integer between 1 and ${MAX_LIMIT}`, 'limit');
    }
    limit = query.limit;
  }

  let decodedCursor: DecodedWorkOrderCursor | undefined;
  if (query.cursor !== undefined && query.cursor !== null && query.cursor !== '') {
    decodedCursor = decodeWorkOrderCursor(query.cursor);
  }

  const prodId = query.productId ? parseProductId(query.productId) : undefined;

  const rows = await deps.workforcePersistence.listWorkOrders(wsId, {
    cursor: decodedCursor,
    limit: limit + 1,
    productId: prodId,
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    if (last) {
      nextCursor = encodeWorkOrderCursor(last.updatedAt, last.id);
    }
  }

  return {
    items: Object.freeze(items),
    nextCursor,
  };
}
