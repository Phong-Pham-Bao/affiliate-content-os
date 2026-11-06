import {
  dateToIsoTimestamp,
  parseProductId,
  type ProductSnapshot,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotUpdateProductCommand } from './command-snapshots.js';
import { ProductNotFoundError, StaleVersionConflictError } from './errors.js';
import { buildProductAuditEvent, getValidClockDate, type CatalogAuditContext } from './helpers.js';
import type { CatalogPersistencePort } from './ports.js';
import { computeProductUpdatesAndAuditChanges } from './product-update-helpers.js';

export interface UpdateProductCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly expectedVersion: number;
  readonly name?: string | undefined;
  readonly merchantName?: string | undefined;
  readonly canonicalUrl?: string | undefined;
  readonly category?: string | undefined;
  readonly description?: string | undefined;
  readonly audienceNotes?: string | null | undefined;
  readonly allowedClaimsNotes?: string | null | undefined;
  readonly prohibitedClaimsNotes?: string | null | undefined;
  readonly status?: string | undefined;
  readonly auditContext?: CatalogAuditContext | undefined;
}

export interface UpdateProductDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export interface UpdateProductResult {
  readonly product: ProductSnapshot;
  readonly duplicateWarning: boolean;
}

export async function updateProduct(
  command: UpdateProductCommand,
  deps: UpdateProductDependencies,
): Promise<UpdateProductResult> {
  const snap = snapshotUpdateProductCommand(command);

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

  if (existing.version !== snap.expectedVersion) {
    throw new StaleVersionConflictError(snap.expectedVersion, existing.version);
  }

  const clockDate = getValidClockDate(deps.clock);
  const now = dateToIsoTimestamp(clockDate);

  const { updates, changes } = computeProductUpdatesAndAuditChanges({
    existing,
    snap,
    now,
  });

  const auditEvent = buildProductAuditEvent({
    workspaceId: authContext.workspaceId,
    userId: authContext.userId,
    resourceId: existing.id,
    action: 'catalog.product_updated',
    changes:
      Object.keys(changes).length > 0
        ? changes
        : { updated_at: { before: existing.updatedAt, after: now } },
    now,
    idGenerator: deps.idGenerator,
    auditContext: snap.auditContext,
  });

  const persisted = await deps.catalogPersistence.updateProduct({
    workspaceId: authContext.workspaceId,
    productId: existing.id,
    expectedVersion: existing.version,
    updates,
    auditEvent,
  });

  return {
    product: persisted.product,
    duplicateWarning: persisted.duplicateWarning,
  };
}
