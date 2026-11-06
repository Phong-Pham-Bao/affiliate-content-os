import { parseProductId, type ProductSnapshot } from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotGetProductCommand } from './command-snapshots.js';
import { ProductNotFoundError } from './errors.js';
import type { CatalogPersistencePort } from './ports.js';

export interface GetProductCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
}

export interface GetProductDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export async function getProduct(
  command: GetProductCommand,
  deps: GetProductDependencies,
): Promise<ProductSnapshot> {
  const snap = snapshotGetProductCommand(command);

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

  return Object.freeze(product);
}
