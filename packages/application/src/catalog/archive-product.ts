import {
  dateToIsoTimestamp,
  parseProductId,
  type ProductSnapshot,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotArchiveProductCommand } from './command-snapshots.js';
import { ProductNotFoundError } from './errors.js';
import { buildProductAuditEvent, getValidClockDate, type CatalogAuditContext } from './helpers.js';
import type { CatalogPersistencePort } from './ports.js';

export interface ArchiveProductCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly auditContext?: CatalogAuditContext | undefined;
}

export interface ArchiveProductDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export interface ArchiveProductResult {
  readonly product: ProductSnapshot;
  readonly alreadyArchived: boolean;
}

export async function archiveProduct(
  command: ArchiveProductCommand,
  deps: ArchiveProductDependencies,
): Promise<ArchiveProductResult> {
  const snap = snapshotArchiveProductCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const productId = parseProductId(snap.productId);

  const existing = await deps.catalogPersistence.findProductById({
    workspaceId: authContext.workspaceId,
    productId,
  });

  if (!existing) {
    throw new ProductNotFoundError(productId);
  }

  if (existing.status === 'archived') {
    return Object.freeze({
      product: Object.freeze(existing),
      alreadyArchived: true,
    });
  }

  const clockDate = getValidClockDate(deps.clock);
  const now = dateToIsoTimestamp(clockDate);

  const auditEvent = buildProductAuditEvent({
    workspaceId: authContext.workspaceId,
    userId: authContext.userId,
    resourceId: existing.id,
    action: 'catalog.product_archived',
    changes: {
      status: { before: existing.status, after: 'archived' },
    },
    now,
    idGenerator: deps.idGenerator,
    auditContext: snap.auditContext,
  });

  const persisted = await deps.catalogPersistence.archiveProduct({
    workspaceId: authContext.workspaceId,
    productId: existing.id,
    updatedAt: now,
    auditEvent,
  });

  return Object.freeze({
    product: Object.freeze(persisted.product),
    alreadyArchived: persisted.alreadyArchived,
  });
}
