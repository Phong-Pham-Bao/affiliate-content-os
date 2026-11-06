import {
  dateToIsoTimestamp,
  DomainValidationError,
  parseProductId,
  validateAffiliateLabel,
  validateAffiliateNetworkName,
  validateSafeHttpUrl,
  type AffiliateDestinationId,
  type AffiliateDestinationSnapshot,
  type AuditScalarChange,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotCreateAffiliateDestinationCommand } from './command-snapshots.js';
import { ProductNotFoundError } from './errors.js';
import {
  buildAffiliateAuditEvent,
  buildAffiliateCreateIdempotencyRecord,
  getValidClockDate,
  resolveAffiliateDestinationId,
  type CatalogAuditContext,
  type ProductCreateIdempotencyInput,
} from './helpers.js';
import type { CatalogPersistencePort } from './ports.js';

export interface CreateAffiliateDestinationCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly label: string;
  readonly url: string;
  readonly networkName?: string | null | undefined;
  readonly idempotency?: ProductCreateIdempotencyInput | undefined;
  readonly auditContext?: CatalogAuditContext | undefined;
}

export interface CreateAffiliateDestinationDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export async function createAffiliateDestination(
  command: CreateAffiliateDestinationCommand,
  deps: CreateAffiliateDestinationDependencies,
): Promise<AffiliateDestinationSnapshot> {
  const snap = snapshotCreateAffiliateDestinationCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.manage',
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

  let validLabel: string;
  let validUrl: string;
  let validNetwork: string | null = null;

  try {
    validLabel = validateAffiliateLabel(snap.label);
    validUrl = validateSafeHttpUrl(snap.url, 'url');
    if (snap.networkName) {
      validNetwork = validateAffiliateNetworkName(snap.networkName);
    }
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  const clockDate = getValidClockDate(deps.clock);
  const now = dateToIsoTimestamp(clockDate);

  const destinationId: AffiliateDestinationId = resolveAffiliateDestinationId(deps.idGenerator);

  const destination: AffiliateDestinationSnapshot = Object.freeze({
    id: destinationId,
    workspaceId: authContext.workspaceId,
    productId,
    status: 'active',
    label: validLabel,
    networkName: validNetwork,
    url: validUrl,
    createdByUserId: authContext.userId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  const changes: Record<string, AuditScalarChange> = {
    status: { before: null, after: 'active' },
    label: { before: null, after: destination.label },
  };
  if (destination.networkName) {
    changes.network_name = { before: null, after: destination.networkName };
  }

  const auditEvent = buildAffiliateAuditEvent({
    workspaceId: authContext.workspaceId,
    userId: authContext.userId,
    resourceId: destination.id,
    action: 'catalog.affiliate_created',
    changes,
    now,
    idGenerator: deps.idGenerator,
    auditContext: snap.auditContext,
  });

  const idempotencyRecord = snap.idempotency
    ? buildAffiliateCreateIdempotencyRecord({
        workspaceId: authContext.workspaceId,
        productId,
        destinationId: destination.id,
        userId: authContext.userId,
        now,
        clockDate,
        idGenerator: deps.idGenerator,
        idempotency: snap.idempotency,
      })
    : undefined;

  const result = await deps.catalogPersistence.createAffiliateDestination({
    destination,
    auditEvent,
    idempotencyRecord,
  });

  return Object.freeze(result.destination);
}
