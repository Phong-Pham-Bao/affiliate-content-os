import { parseProductId, type ProductFactSetSnapshot } from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotListFactSetsCommand } from './command-snapshots.js';
import { decodeFactSetCursor, encodeFactSetCursor } from './cursor.js';
import { ProductNotFoundError } from './errors.js';
import type { CatalogPersistencePort } from './ports.js';

export interface ListFactSetsCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly limit?: number | undefined;
  readonly cursor?: string | null | undefined;
}

export interface ListFactSetsDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export interface ListFactSetsResult {
  readonly items: readonly ProductFactSetSnapshot[];
  readonly nextCursor: string | null;
}

export async function listFactSets(
  command: ListFactSetsCommand,
  deps: ListFactSetsDependencies,
): Promise<ListFactSetsResult> {
  const snap = snapshotListFactSetsCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const productId = parseProductId(snap.productId);

  const product = await deps.catalogPersistence.findProductById({
    workspaceId: authContext.workspaceId,
    productId,
  });

  if (!product) {
    throw new ProductNotFoundError(productId);
  }

  const decodedCursor = snap.cursor ? decodeFactSetCursor(snap.cursor) : undefined;

  const result = await deps.catalogPersistence.listFactSets({
    workspaceId: authContext.workspaceId,
    productId,
    limit: snap.limit,
    cursor: decodedCursor,
  });

  return Object.freeze({
    items: Object.freeze(result.items),
    nextCursor: result.nextCursor ? encodeFactSetCursor(result.nextCursor) : null,
  });
}
