import {
  dateToIsoTimestamp,
  parseProductFactSetId,
  parseProductId,
  type ProductFactSetSnapshot,
  type ProductSnapshot,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotConfirmFactSetCommand } from './command-snapshots.js';
import { FactSetNotFoundError, ProductNotFoundError } from './errors.js';
import { buildFactSetAuditEvent, getValidClockDate, type CatalogAuditContext } from './helpers.js';
import type { CatalogPersistencePort } from './ports.js';

export interface ConfirmFactSetCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly factSetId: string;
  readonly auditContext?: CatalogAuditContext | undefined;
}

export interface ConfirmFactSetDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export interface ConfirmFactSetResult {
  readonly factSet: ProductFactSetSnapshot;
  readonly product: ProductSnapshot;
  readonly alreadyConfirmed: boolean;
}

export async function confirmFactSet(
  command: ConfirmFactSetCommand,
  deps: ConfirmFactSetDependencies,
): Promise<ConfirmFactSetResult> {
  const snap = snapshotConfirmFactSetCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const productId = parseProductId(snap.productId);
  const factSetId = parseProductFactSetId(snap.factSetId);

  const product = await deps.catalogPersistence.findProductById({
    workspaceId: authContext.workspaceId,
    productId,
  });

  if (!product) {
    throw new ProductNotFoundError(productId);
  }

  const existingFactSet = await deps.catalogPersistence.findFactSetById({
    workspaceId: authContext.workspaceId,
    productId,
    factSetId,
  });

  if (!existingFactSet) {
    throw new FactSetNotFoundError(factSetId);
  }

  if (existingFactSet.factSet.status === 'confirmed') {
    return Object.freeze({
      factSet: Object.freeze(existingFactSet.factSet),
      product: Object.freeze(product),
      alreadyConfirmed: true,
    });
  }

  const clockDate = getValidClockDate(deps.clock);
  const now = dateToIsoTimestamp(clockDate);

  const auditEvent = buildFactSetAuditEvent({
    workspaceId: authContext.workspaceId,
    userId: authContext.userId,
    resourceId: existingFactSet.factSet.id,
    action: 'catalog.fact_set_confirmed',
    changes: {
      status: { before: 'proposed', after: 'confirmed' },
    },
    now,
    idGenerator: deps.idGenerator,
    auditContext: snap.auditContext,
  });

  const persisted = await deps.catalogPersistence.confirmFactSet({
    workspaceId: authContext.workspaceId,
    productId,
    factSetId,
    confirmedByUserId: authContext.userId,
    confirmedAt: now,
    auditEvent,
  });

  return Object.freeze({
    factSet: Object.freeze(persisted.factSet),
    product: Object.freeze(persisted.product),
    alreadyConfirmed: persisted.alreadyConfirmed,
  });
}
