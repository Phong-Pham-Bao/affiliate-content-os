import {
  isAffiliateDestinationStatus,
  parseProductId,
  type AffiliateDestinationSnapshot,
  type AffiliateDestinationStatus,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotListAffiliateDestinationsCommand } from './command-snapshots.js';
import { decodeAffiliateCursor, encodeAffiliateCursor } from './cursor.js';
import { ProductNotFoundError } from './errors.js';
import type { CatalogPersistencePort } from './ports.js';

export interface ListAffiliateDestinationsCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly status?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | null | undefined;
}

export interface ListAffiliateDestinationsDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export interface ListAffiliateDestinationsResult {
  readonly items: readonly AffiliateDestinationSnapshot[];
  readonly nextCursor: string | null;
}

export async function listAffiliateDestinations(
  command: ListAffiliateDestinationsCommand,
  deps: ListAffiliateDestinationsDependencies,
): Promise<ListAffiliateDestinationsResult> {
  const snap = snapshotListAffiliateDestinationsCommand(command);

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

  let filterStatus: AffiliateDestinationStatus | undefined;
  if (snap.status !== undefined) {
    if (!isAffiliateDestinationStatus(snap.status)) {
      throw new ValidationError(
        `Invalid affiliate destination status filter: ${snap.status}. Must be active or archived`,
        'status',
      );
    }
    filterStatus = snap.status;
  }

  const decodedCursor = snap.cursor ? decodeAffiliateCursor(snap.cursor) : undefined;

  const result = await deps.catalogPersistence.listAffiliateDestinations({
    workspaceId: authContext.workspaceId,
    productId,
    status: filterStatus,
    limit: snap.limit,
    cursor: decodedCursor,
  });

  return Object.freeze({
    items: Object.freeze(result.items),
    nextCursor: result.nextCursor ? encodeAffiliateCursor(result.nextCursor) : null,
  });
}
