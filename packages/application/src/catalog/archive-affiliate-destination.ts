import {
  dateToIsoTimestamp,
  parseAffiliateDestinationId,
  parseProductId,
  type AffiliateDestinationSnapshot,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotArchiveAffiliateDestinationCommand } from './command-snapshots.js';
import { AffiliateDestinationNotFoundError, ProductNotFoundError } from './errors.js';
import {
  buildAffiliateAuditEvent,
  getValidClockDate,
  type CatalogAuditContext,
} from './helpers.js';
import type { CatalogPersistencePort } from './ports.js';

export interface ArchiveAffiliateDestinationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly destinationId: string;
  readonly auditContext?: CatalogAuditContext | undefined;
}

export interface ArchiveAffiliateDestinationDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export interface ArchiveAffiliateDestinationResult {
  readonly destination: AffiliateDestinationSnapshot;
  readonly alreadyArchived: boolean;
}

export async function archiveAffiliateDestination(
  command: ArchiveAffiliateDestinationCommand,
  deps: ArchiveAffiliateDestinationDependencies,
): Promise<ArchiveAffiliateDestinationResult> {
  const safe = snapshotArchiveAffiliateDestinationCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: safe.workspaceId,
      userId: safe.userId,
      capability: 'catalog.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const productId = parseProductId(safe.productId);
  const destinationId = parseAffiliateDestinationId(safe.destinationId);

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

  if (existing.status === 'archived') {
    return Object.freeze({
      destination: Object.freeze(existing),
      alreadyArchived: true,
    });
  }

  const clockDate = getValidClockDate(deps.clock);
  const now = dateToIsoTimestamp(clockDate);

  const auditEvent = buildAffiliateAuditEvent({
    workspaceId: authContext.workspaceId,
    userId: authContext.userId,
    resourceId: destinationId,
    action: 'catalog.affiliate_archived',
    changes: {
      status: { before: existing.status, after: 'archived' },
    },
    now,
    idGenerator: deps.idGenerator,
    auditContext: safe.auditContext,
  });

  const result = await deps.catalogPersistence.archiveAffiliateDestination({
    workspaceId: authContext.workspaceId,
    productId,
    destinationId,
    updatedAt: now,
    auditEvent,
  });

  return Object.freeze({
    destination: Object.freeze(result.destination),
    alreadyArchived: result.alreadyArchived,
  });
}
