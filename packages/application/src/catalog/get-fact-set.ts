import {
  parseProductFactSetId,
  parseProductId,
  type ProductFactSetSnapshot,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotGetFactSetCommand } from './command-snapshots.js';
import { FactSetNotFoundError } from './errors.js';
import type { CatalogPersistencePort } from './ports.js';

export interface GetFactSetCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly factSetId: string;
}

export interface GetFactSetDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export interface GetFactSetResult {
  readonly factSet: ProductFactSetSnapshot;
  readonly facts: readonly ProductFactSnapshot[];
}

export async function getFactSet(
  command: GetFactSetCommand,
  deps: GetFactSetDependencies,
): Promise<GetFactSetResult> {
  const snap = snapshotGetFactSetCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.read',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const productId = parseProductId(snap.productId);
  const factSetId = parseProductFactSetId(snap.factSetId);

  const result = await deps.catalogPersistence.findFactSetById({
    workspaceId: authContext.workspaceId,
    productId,
    factSetId,
  });

  if (!result) {
    throw new FactSetNotFoundError(factSetId);
  }

  return Object.freeze({
    factSet: Object.freeze(result.factSet),
    facts: Object.freeze(result.facts),
  });
}
