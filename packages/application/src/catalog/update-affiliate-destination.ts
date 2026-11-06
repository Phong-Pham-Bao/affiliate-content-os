import {
  dateToIsoTimestamp,
  parseAffiliateDestinationId,
  parseProductId,
  validateAffiliateLabel,
  validateAffiliateNetworkName,
  validateSafeHttpUrl,
  type AffiliateDestinationSnapshot,
  type AuditScalarChange,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotUpdateAffiliateDestinationCommand } from './command-snapshots.js';
import {
  AffiliateDestinationNotFoundError,
  ProductNotFoundError,
  StaleVersionConflictError,
} from './errors.js';
import {
  buildAffiliateAuditEvent,
  getValidClockDate,
  type CatalogAuditContext,
} from './helpers.js';
import type { CatalogPersistencePort, UpdateAffiliateDestinationFields } from './ports.js';

export interface UpdateAffiliateDestinationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly destinationId: string;
  readonly expectedVersion: number;
  readonly label?: string | undefined;
  readonly url?: string | undefined;
  readonly networkName?: string | null | undefined;
  readonly auditContext?: CatalogAuditContext | undefined;
}

export interface UpdateAffiliateDestinationDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export async function updateAffiliateDestination(
  command: UpdateAffiliateDestinationCommand,
  deps: UpdateAffiliateDestinationDependencies,
): Promise<AffiliateDestinationSnapshot> {
  const snap = snapshotUpdateAffiliateDestinationCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const productId = parseProductId(snap.productId);
  const destinationId = parseAffiliateDestinationId(snap.destinationId);

  const product = await deps.catalogPersistence.findProductById({
    workspaceId: authContext.workspaceId,
    productId,
  });

  if (!product) {
    throw new ProductNotFoundError(productId);
  }

  const existing = await deps.catalogPersistence.findAffiliateDestinationById({
    workspaceId: authContext.workspaceId,
    productId,
    destinationId,
  });

  if (!existing) {
    throw new AffiliateDestinationNotFoundError(destinationId);
  }

  if (existing.version !== snap.expectedVersion) {
    throw new StaleVersionConflictError(snap.expectedVersion, existing.version);
  }

  const changes: Record<string, AuditScalarChange> = {};

  let updatedLabel = existing.label;
  if (snap.label !== undefined) {
    updatedLabel = validateAffiliateLabel(snap.label);
    if (updatedLabel !== existing.label) {
      changes.label = { before: existing.label, after: updatedLabel };
    }
  }

  let updatedUrl = existing.url;
  if (snap.url !== undefined) {
    updatedUrl = validateSafeHttpUrl(snap.url, 'url');
    if (updatedUrl !== existing.url) {
      changes.link_updated = { before: 'false', after: 'true' };
    }
  }

  let updatedNetwork = existing.networkName;
  if (snap.networkName !== undefined) {
    updatedNetwork = snap.networkName ? validateAffiliateNetworkName(snap.networkName) : null;
    if (updatedNetwork !== existing.networkName) {
      changes.network_name = {
        before: existing.networkName ?? 'none',
        after: updatedNetwork ?? 'none',
      };
    }
  }

  const clockDate = getValidClockDate(deps.clock);
  const now = dateToIsoTimestamp(clockDate);

  const updates: UpdateAffiliateDestinationFields = {
    label: updatedLabel,
    url: updatedUrl,
    networkName: updatedNetwork,
    updatedAt: now,
  };

  const auditEvent = buildAffiliateAuditEvent({
    workspaceId: authContext.workspaceId,
    userId: authContext.userId,
    resourceId: existing.id,
    action: 'catalog.affiliate_updated',
    changes:
      Object.keys(changes).length > 0
        ? changes
        : { updated_at: { before: existing.updatedAt, after: now } },
    now,
    idGenerator: deps.idGenerator,
    auditContext: snap.auditContext,
  });

  const persisted = await deps.catalogPersistence.updateAffiliateDestination({
    workspaceId: authContext.workspaceId,
    productId,
    destinationId,
    expectedVersion: existing.version,
    updates,
    auditEvent,
  });

  return Object.freeze(persisted);
}
