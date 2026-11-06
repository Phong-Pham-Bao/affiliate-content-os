import type {
  AffiliateDestinationId,
  AffiliateDestinationSnapshot,
  AffiliateDestinationStatus,
  AuditEventSnapshot,
  IdempotencyRecordSnapshot,
  IsoTimestamp,
  ProductFactSetId,
  ProductFactSetSnapshot,
  ProductFactSnapshot,
  ProductId,
  ProductSnapshot,
  ProductStatus,
  UserId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type {
  DecodedAffiliateCursor,
  DecodedFactSetCursor,
  DecodedProductCursor,
} from './cursor.js';

export interface CreateProductPersistenceParams {
  readonly product: ProductSnapshot;
  readonly idempotencyRecord: IdempotencyRecordSnapshot;
  readonly auditEvent: AuditEventSnapshot;
}

export interface CreateProductPersistenceResult {
  readonly product: ProductSnapshot;
  readonly idempotencyRecord: IdempotencyRecordSnapshot;
  readonly duplicateWarning: boolean;
  readonly cached: boolean;
}

export interface ListProductsPersistenceParams {
  readonly workspaceId: WorkspaceId;
  readonly status?: ProductStatus | undefined;
  readonly cursor?: DecodedProductCursor | undefined;
  readonly limit: number;
}

export interface ListProductsPersistenceResult {
  readonly items: readonly ProductSnapshot[];
  readonly nextCursor: DecodedProductCursor | null;
}

export interface UpdateProductFields {
  readonly name: string;
  readonly merchantName: string;
  readonly canonicalUrl: string;
  readonly canonicalUrlHash: Uint8Array;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes: string | null;
  readonly allowedClaimsNotes: string | null;
  readonly prohibitedClaimsNotes: string | null;
  readonly status: ProductStatus;
  readonly updatedAt: IsoTimestamp;
}

export interface UpdateProductPersistenceParams {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly expectedVersion: number;
  readonly updates: UpdateProductFields;
  readonly auditEvent: AuditEventSnapshot;
}

export interface UpdateProductPersistenceResult {
  readonly product: ProductSnapshot;
  readonly duplicateWarning: boolean;
}

export interface ArchiveProductPersistenceParams {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly updatedAt: IsoTimestamp;
  readonly auditEvent: AuditEventSnapshot;
}

export interface ArchiveProductPersistenceResult {
  readonly product: ProductSnapshot;
  readonly alreadyArchived: boolean;
}

export interface CreateFactSetPersistenceParams {
  readonly factSet: Omit<ProductFactSetSnapshot, 'revisionNumber'>;
  readonly facts: readonly ProductFactSnapshot[];
  readonly auditEvent: AuditEventSnapshot;
  readonly idempotencyRecord?: IdempotencyRecordSnapshot | undefined;
}

export interface CreateFactSetPersistenceResult {
  readonly factSet: ProductFactSetSnapshot;
  readonly facts: readonly ProductFactSnapshot[];
  readonly cached?: boolean | undefined;
}

export interface FactSetWithFacts {
  readonly factSet: ProductFactSetSnapshot;
  readonly facts: readonly ProductFactSnapshot[];
}

export interface ListFactSetsPersistenceParams {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly limit: number;
  readonly cursor?: DecodedFactSetCursor | undefined;
}

export interface ListFactSetsPersistenceResult {
  readonly items: readonly ProductFactSetSnapshot[];
  readonly nextCursor: DecodedFactSetCursor | null;
}

export interface ConfirmFactSetPersistenceParams {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly factSetId: ProductFactSetId;
  readonly confirmedByUserId: UserId;
  readonly confirmedAt: IsoTimestamp;
  readonly auditEvent: AuditEventSnapshot;
}

export interface ConfirmFactSetPersistenceResult {
  readonly factSet: ProductFactSetSnapshot;
  readonly product: ProductSnapshot;
  readonly alreadyConfirmed: boolean;
}

export interface CreateAffiliateDestinationPersistenceParams {
  readonly destination: AffiliateDestinationSnapshot;
  readonly auditEvent: AuditEventSnapshot;
  readonly idempotencyRecord?: IdempotencyRecordSnapshot | undefined;
}

export interface CreateAffiliateDestinationPersistenceResult {
  readonly destination: AffiliateDestinationSnapshot;
  readonly cached?: boolean | undefined;
}

export interface ListAffiliateDestinationsPersistenceParams {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly status?: AffiliateDestinationStatus | undefined;
  readonly limit: number;
  readonly cursor?: DecodedAffiliateCursor | undefined;
}

export interface ListAffiliateDestinationsPersistenceResult {
  readonly items: readonly AffiliateDestinationSnapshot[];
  readonly nextCursor: DecodedAffiliateCursor | null;
}

export interface UpdateAffiliateDestinationFields {
  readonly label: string;
  readonly url: string;
  readonly networkName: string | null;
  readonly updatedAt: IsoTimestamp;
}

export interface UpdateAffiliateDestinationPersistenceParams {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly destinationId: AffiliateDestinationId;
  readonly expectedVersion: number;
  readonly updates: UpdateAffiliateDestinationFields;
  readonly auditEvent: AuditEventSnapshot;
}

export interface ArchiveAffiliateDestinationPersistenceParams {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly destinationId: AffiliateDestinationId;
  readonly updatedAt: IsoTimestamp;
  readonly auditEvent: AuditEventSnapshot;
}

export interface ArchiveAffiliateDestinationPersistenceResult {
  readonly destination: AffiliateDestinationSnapshot;
  readonly alreadyArchived: boolean;
}

export interface CatalogPersistencePort {
  createProduct(params: CreateProductPersistenceParams): Promise<CreateProductPersistenceResult>;
  findProductById(params: {
    readonly workspaceId: WorkspaceId;
    readonly productId: ProductId;
  }): Promise<ProductSnapshot | null>;
  findProductByCanonicalUrlHash(params: {
    readonly workspaceId: WorkspaceId;
    readonly canonicalUrlHash: Uint8Array;
    readonly excludeProductId?: ProductId | undefined;
  }): Promise<ProductSnapshot | null>;
  listProducts(params: ListProductsPersistenceParams): Promise<ListProductsPersistenceResult>;
  updateProduct(params: UpdateProductPersistenceParams): Promise<UpdateProductPersistenceResult>;
  archiveProduct(params: ArchiveProductPersistenceParams): Promise<ArchiveProductPersistenceResult>;

  createFactSet(params: CreateFactSetPersistenceParams): Promise<CreateFactSetPersistenceResult>;
  findFactSetById(params: {
    readonly workspaceId: WorkspaceId;
    readonly productId: ProductId;
    readonly factSetId: ProductFactSetId;
  }): Promise<FactSetWithFacts | null>;
  listFactSets(params: ListFactSetsPersistenceParams): Promise<ListFactSetsPersistenceResult>;
  confirmFactSet(params: ConfirmFactSetPersistenceParams): Promise<ConfirmFactSetPersistenceResult>;

  createAffiliateDestination(
    params: CreateAffiliateDestinationPersistenceParams,
  ): Promise<CreateAffiliateDestinationPersistenceResult>;
  findAffiliateDestinationById(params: {
    readonly workspaceId: WorkspaceId;
    readonly productId: ProductId;
    readonly destinationId: AffiliateDestinationId;
  }): Promise<AffiliateDestinationSnapshot | null>;
  listAffiliateDestinations(
    params: ListAffiliateDestinationsPersistenceParams,
  ): Promise<ListAffiliateDestinationsPersistenceResult>;
  updateAffiliateDestination(
    params: UpdateAffiliateDestinationPersistenceParams,
  ): Promise<AffiliateDestinationSnapshot>;
  archiveAffiliateDestination(
    params: ArchiveAffiliateDestinationPersistenceParams,
  ): Promise<ArchiveAffiliateDestinationPersistenceResult>;
}
