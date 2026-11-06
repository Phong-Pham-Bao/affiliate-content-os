import {
  isProductStatus,
  type ProductSnapshot,
  type ProductStatus,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotListProductsCommand } from './command-snapshots.js';
import { decodeProductCursor, encodeProductCursor } from './cursor.js';
import type { CatalogPersistencePort } from './ports.js';

export interface ListProductsCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly status?: string | undefined;
  readonly cursor?: string | null | undefined;
  readonly limit?: number | undefined;
}

export interface ListProductsDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export interface ListProductsResult {
  readonly items: readonly ProductSnapshot[];
  readonly nextCursor: string | null;
}

export async function listProducts(
  command: ListProductsCommand,
  deps: ListProductsDependencies,
): Promise<ListProductsResult> {
  const snap = snapshotListProductsCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  let filterStatus: ProductStatus | undefined;
  if (snap.status !== undefined) {
    if (!isProductStatus(snap.status)) {
      throw new ValidationError(
        `Invalid status filter: ${snap.status}. Must be draft, active, or archived`,
        'status',
      );
    }
    filterStatus = snap.status;
  }

  const decodedCursor = snap.cursor ? decodeProductCursor(snap.cursor) : undefined;

  const result = await deps.catalogPersistence.listProducts({
    workspaceId: authContext.workspaceId,
    status: filterStatus,
    cursor: decodedCursor,
    limit: snap.limit,
  });

  return {
    items: result.items,
    nextCursor: result.nextCursor ? encodeProductCursor(result.nextCursor) : null,
  };
}
