import {
  computeCanonicalUrlHash,
  dateToIsoTimestamp,
  DomainValidationError,
  normalizeCanonicalProductUrl,
  validateAllowedClaimsNotes,
  validateAudienceNotes,
  validateCategory,
  validateDescription,
  validateMerchantName,
  validateProductName,
  validateProhibitedClaimsNotes,
  type ProductId,
  type ProductSnapshot,
  type ProductStatus,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import { ValidationError } from '../errors.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotCreateProductCommand } from './command-snapshots.js';
import {
  buildProductAuditEvent,
  buildProductCreateIdempotencyRecord,
  getValidClockDate,
  resolveProductId,
  type CatalogAuditContext,
  type ProductCreateIdempotencyInput,
} from './helpers.js';
import type { CatalogPersistencePort } from './ports.js';

export interface CreateProductCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly merchantName: string;
  readonly canonicalUrl: string;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes?: string | null | undefined;
  readonly allowedClaimsNotes?: string | null | undefined;
  readonly prohibitedClaimsNotes?: string | null | undefined;
  readonly status?: string | undefined;
  readonly idempotency: ProductCreateIdempotencyInput;
  readonly auditContext?: CatalogAuditContext | undefined;
}

export interface CreateProductDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export interface CreateProductResult {
  readonly product: ProductSnapshot;
  readonly duplicateWarning: boolean;
  readonly cached: boolean;
}

export async function createProduct(
  command: CreateProductCommand,
  deps: CreateProductDependencies,
): Promise<CreateProductResult> {
  const snap = snapshotCreateProductCommand(command);

  if (!snap.idempotency) {
    throw new ValidationError('idempotency is required', 'idempotency');
  }

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  let validName: string;
  let validMerchantName: string;
  let normalizedCanonicalUrl: string;
  let canonicalUrlHash: Uint8Array;
  let validCategory: string;
  let validDescription: string;
  let audienceNotes: string | null;
  let allowedClaimsNotes: string | null;
  let prohibitedClaimsNotes: string | null;

  try {
    validName = validateProductName(snap.name);
    validMerchantName = validateMerchantName(snap.merchantName);
    normalizedCanonicalUrl = normalizeCanonicalProductUrl(snap.canonicalUrl);
    canonicalUrlHash = computeCanonicalUrlHash(normalizedCanonicalUrl);
    validCategory = validateCategory(snap.category);
    validDescription = validateDescription(snap.description);
    audienceNotes = validateAudienceNotes(snap.audienceNotes);
    allowedClaimsNotes = validateAllowedClaimsNotes(snap.allowedClaimsNotes);
    prohibitedClaimsNotes = validateProhibitedClaimsNotes(snap.prohibitedClaimsNotes);
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new ValidationError(err.message, err.field);
    }
    throw err;
  }

  const status: ProductStatus = snap.status;
  const clockDate = getValidClockDate(deps.clock);
  const now = dateToIsoTimestamp(clockDate);
  const productId: ProductId = resolveProductId(deps.idGenerator);

  const product: ProductSnapshot = Object.freeze({
    id: productId,
    workspaceId: authContext.workspaceId,
    name: validName,
    merchantName: validMerchantName,
    canonicalUrl: normalizedCanonicalUrl,
    canonicalUrlHash,
    category: validCategory,
    description: validDescription,
    audienceNotes,
    allowedClaimsNotes,
    prohibitedClaimsNotes,
    status,
    currentFactSetId: null,
    createdByUserId: authContext.userId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  const idempotencyRecord = buildProductCreateIdempotencyRecord({
    product,
    userId: authContext.userId,
    duplicateWarning: false,
    now,
    clockDate,
    idGenerator: deps.idGenerator,
    idempotency: snap.idempotency,
  });

  const auditEvent = buildProductAuditEvent({
    workspaceId: authContext.workspaceId,
    userId: authContext.userId,
    resourceId: product.id,
    action: 'catalog.product_created',
    changes: {
      status: { before: null, after: product.status },
      name: { before: null, after: product.name },
      merchant_name: { before: null, after: product.merchantName },
      category: { before: null, after: product.category },
    },
    now,
    idGenerator: deps.idGenerator,
    auditContext: snap.auditContext,
  });

  const persisted = await deps.catalogPersistence.createProduct({
    product,
    idempotencyRecord,
    auditEvent,
  });

  return {
    product: persisted.product,
    duplicateWarning: persisted.duplicateWarning,
    cached: persisted.cached,
  };
}
