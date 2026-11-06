import crypto from 'node:crypto';
import type {
  AffiliateDestinationSnapshot,
  ProductFactSetSnapshot,
  ProductFactSnapshot,
  ProductId,
  ProductSnapshot,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type {
  ArchiveAffiliateDestinationPersistenceParams,
  ArchiveAffiliateDestinationPersistenceResult,
  ArchiveProductPersistenceParams,
  ArchiveProductPersistenceResult,
  CatalogPersistencePort,
  ConfirmFactSetPersistenceParams,
  ConfirmFactSetPersistenceResult,
  CreateAffiliateDestinationPersistenceParams,
  CreateAffiliateDestinationPersistenceResult,
  CreateFactSetPersistenceParams,
  CreateFactSetPersistenceResult,
  CreateProductPersistenceParams,
  CreateProductPersistenceResult,
  FactSetWithFacts,
  ListAffiliateDestinationsPersistenceParams,
  ListAffiliateDestinationsPersistenceResult,
  ListFactSetsPersistenceParams,
  ListFactSetsPersistenceResult,
  ListProductsPersistenceParams,
  ListProductsPersistenceResult,
  UpdateAffiliateDestinationPersistenceParams,
  UpdateProductPersistenceParams,
  UpdateProductPersistenceResult,
} from '@affiliate-content-os/application';
import {
  AffiliateDestinationNotFoundError,
  FactSetNotFoundError,
  IdempotencyKeyReusedError,
  ProductNotFoundError,
  StaleVersionConflictError,
} from '@affiliate-content-os/application';

interface IdempotencyItem {
  readonly requestHash: Uint8Array;
  readonly result: unknown;
}

export class InMemoryCatalogPersistence implements CatalogPersistencePort {
  public readonly products = new Map<string, ProductSnapshot>();
  public readonly factSets = new Map<string, ProductFactSetSnapshot>();
  public readonly factSetFacts = new Map<string, ProductFactSnapshot[]>();
  public readonly affiliates = new Map<string, AffiliateDestinationSnapshot>();
  public readonly idempotency = new Map<string, IdempotencyItem>();
  public readonly revisions = new Map<string, number>();

  private productKey(workspaceId: string, productId: string): string {
    return `${workspaceId}:${productId}`;
  }

  private factSetKey(workspaceId: string, productId: string, factSetId: string): string {
    return `${workspaceId}:${productId}:${factSetId}`;
  }

  private affiliateKey(workspaceId: string, productId: string, destId: string): string {
    return `${workspaceId}:${productId}:${destId}`;
  }

  private idempKey(principalId: string, keyHash: Uint8Array): string {
    return `${principalId}:${Buffer.from(keyHash).toString('hex')}`;
  }

  async createProduct(
    params: CreateProductPersistenceParams,
  ): Promise<CreateProductPersistenceResult> {
    const idemp = params.idempotencyRecord;
    const key = this.idempKey(idemp.principalId, idemp.keyHash);
    const existing = this.idempotency.get(key);
    if (existing) {
      if (
        crypto.timingSafeEqual(Buffer.from(existing.requestHash), Buffer.from(idemp.requestHash))
      ) {
        return {
          product: existing.result as ProductSnapshot,
          idempotencyRecord: idemp,
          duplicateWarning: false,
          cached: true,
        };
      }
      throw new IdempotencyKeyReusedError();
    }

    const dup = await this.findProductByCanonicalUrlHash({
      workspaceId: params.product.workspaceId,
      canonicalUrlHash: params.product.canonicalUrlHash,
    });

    this.products.set(
      this.productKey(params.product.workspaceId, params.product.id),
      params.product,
    );
    this.idempotency.set(key, {
      requestHash: new Uint8Array(idemp.requestHash),
      result: params.product,
    });

    return {
      product: params.product,
      idempotencyRecord: idemp,
      duplicateWarning: Boolean(dup),
      cached: false,
    };
  }

  async findProductById(params: {
    readonly workspaceId: WorkspaceId;
    readonly productId: ProductId;
  }): Promise<ProductSnapshot | null> {
    return this.products.get(this.productKey(params.workspaceId, params.productId)) ?? null;
  }

  async findProductByCanonicalUrlHash(params: {
    readonly workspaceId: WorkspaceId;
    readonly canonicalUrlHash: Uint8Array;
    readonly excludeProductId?: ProductId | undefined;
  }): Promise<ProductSnapshot | null> {
    for (const p of this.products.values()) {
      if (p.workspaceId === params.workspaceId && p.id !== params.excludeProductId) {
        if (Buffer.from(p.canonicalUrlHash).equals(Buffer.from(params.canonicalUrlHash))) {
          return p;
        }
      }
    }
    return null;
  }

  async listProducts(
    params: ListProductsPersistenceParams,
  ): Promise<ListProductsPersistenceResult> {
    let all = Array.from(this.products.values()).filter(
      (p) => p.workspaceId === params.workspaceId,
    );
    if (params.status) {
      all = all.filter((p) => p.status === params.status);
    }
    all.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));
    const items = all.slice(0, params.limit);
    return { items, nextCursor: null };
  }

  async updateProduct(
    params: UpdateProductPersistenceParams,
  ): Promise<UpdateProductPersistenceResult> {
    const existing = await this.findProductById(params);
    if (!existing) {
      throw new ProductNotFoundError(params.productId);
    }
    if (existing.version !== params.expectedVersion) {
      throw new StaleVersionConflictError(params.expectedVersion, existing.version);
    }

    const dup = await this.findProductByCanonicalUrlHash({
      workspaceId: params.workspaceId,
      canonicalUrlHash: params.updates.canonicalUrlHash,
      excludeProductId: params.productId,
    });

    const updated: ProductSnapshot = {
      ...existing,
      name: params.updates.name,
      merchantName: params.updates.merchantName,
      canonicalUrl: params.updates.canonicalUrl,
      canonicalUrlHash: params.updates.canonicalUrlHash,
      category: params.updates.category,
      description: params.updates.description,
      audienceNotes: params.updates.audienceNotes,
      allowedClaimsNotes: params.updates.allowedClaimsNotes,
      prohibitedClaimsNotes: params.updates.prohibitedClaimsNotes,
      status: params.updates.status,
      updatedAt: params.updates.updatedAt,
      version: existing.version + 1,
    };
    this.products.set(this.productKey(params.workspaceId, params.productId), updated);
    return { product: updated, duplicateWarning: Boolean(dup) };
  }

  async archiveProduct(
    params: ArchiveProductPersistenceParams,
  ): Promise<ArchiveProductPersistenceResult> {
    const existing = await this.findProductById(params);
    if (!existing) {
      throw new ProductNotFoundError(params.productId);
    }
    if (existing.status === 'archived') {
      return { product: existing, alreadyArchived: true };
    }
    const archived: ProductSnapshot = {
      ...existing,
      status: 'archived',
      updatedAt: params.updatedAt,
      version: existing.version + 1,
    };
    this.products.set(this.productKey(params.workspaceId, params.productId), archived);
    return { product: archived, alreadyArchived: false };
  }

  async createFactSet(
    params: CreateFactSetPersistenceParams,
  ): Promise<CreateFactSetPersistenceResult> {
    if (params.idempotencyRecord) {
      const idemp = params.idempotencyRecord;
      const key = this.idempKey(idemp.principalId, idemp.keyHash);
      const existing = this.idempotency.get(key);
      if (existing) {
        if (
          crypto.timingSafeEqual(Buffer.from(existing.requestHash), Buffer.from(idemp.requestHash))
        ) {
          const cached = existing.result as FactSetWithFacts;
          return { factSet: cached.factSet, facts: cached.facts, cached: true };
        }
        throw new IdempotencyKeyReusedError();
      }
    }

    const revKey = this.productKey(params.factSet.workspaceId, params.factSet.productId);
    const nextRev = (this.revisions.get(revKey) ?? 0) + 1;
    this.revisions.set(revKey, nextRev);

    const factSet: ProductFactSetSnapshot = { ...params.factSet, revisionNumber: nextRev };
    const fsKey = this.factSetKey(factSet.workspaceId, factSet.productId, factSet.id);
    this.factSets.set(fsKey, factSet);
    this.factSetFacts.set(fsKey, [...params.facts]);

    if (params.idempotencyRecord) {
      const idemp = params.idempotencyRecord;
      const key = this.idempKey(idemp.principalId, idemp.keyHash);
      this.idempotency.set(key, {
        requestHash: new Uint8Array(idemp.requestHash),
        result: { factSet, facts: [...params.facts] },
      });
    }

    return { factSet, facts: params.facts, cached: false };
  }

  async findFactSetById(params: {
    readonly workspaceId: WorkspaceId;
    readonly productId: ProductId;
    readonly factSetId: ProductFactSetSnapshot['id'];
  }): Promise<FactSetWithFacts | null> {
    const fs = this.factSets.get(
      this.factSetKey(params.workspaceId, params.productId, params.factSetId),
    );
    if (!fs) return null;
    const facts =
      this.factSetFacts.get(
        this.factSetKey(params.workspaceId, params.productId, params.factSetId),
      ) ?? [];
    return { factSet: fs, facts };
  }

  async listFactSets(
    params: ListFactSetsPersistenceParams,
  ): Promise<ListFactSetsPersistenceResult> {
    const all = Array.from(this.factSets.values()).filter(
      (fs) => fs.workspaceId === params.workspaceId && fs.productId === params.productId,
    );
    all.sort((a, b) => b.revisionNumber - a.revisionNumber);
    return { items: all.slice(0, params.limit), nextCursor: null };
  }

  async confirmFactSet(
    params: ConfirmFactSetPersistenceParams,
  ): Promise<ConfirmFactSetPersistenceResult> {
    const existing = await this.findFactSetById(params);
    if (!existing) {
      throw new FactSetNotFoundError(params.factSetId);
    }
    const product = await this.findProductById(params);
    if (!product) {
      throw new ProductNotFoundError(params.productId);
    }

    if (existing.factSet.status === 'confirmed') {
      return { factSet: existing.factSet, product, alreadyConfirmed: true };
    }

    const confirmedFactSet: ProductFactSetSnapshot = {
      ...existing.factSet,
      status: 'confirmed',
      confirmedAt: params.confirmedAt,
      confirmedByUserId: params.confirmedByUserId,
      version: existing.factSet.version + 1,
    };
    this.factSets.set(
      this.factSetKey(params.workspaceId, params.productId, params.factSetId),
      confirmedFactSet,
    );

    const updatedProduct: ProductSnapshot = {
      ...product,
      currentFactSetId: params.factSetId,
      updatedAt: params.confirmedAt,
      version: product.version + 1,
    };
    this.products.set(this.productKey(params.workspaceId, params.productId), updatedProduct);

    return { factSet: confirmedFactSet, product: updatedProduct, alreadyConfirmed: false };
  }

  async createAffiliateDestination(
    params: CreateAffiliateDestinationPersistenceParams,
  ): Promise<CreateAffiliateDestinationPersistenceResult> {
    if (params.idempotencyRecord) {
      const idemp = params.idempotencyRecord;
      const key = this.idempKey(idemp.principalId, idemp.keyHash);
      const existing = this.idempotency.get(key);
      if (existing) {
        if (
          crypto.timingSafeEqual(Buffer.from(existing.requestHash), Buffer.from(idemp.requestHash))
        ) {
          return { destination: existing.result as AffiliateDestinationSnapshot, cached: true };
        }
        throw new IdempotencyKeyReusedError();
      }
    }

    this.affiliates.set(
      this.affiliateKey(
        params.destination.workspaceId,
        params.destination.productId,
        params.destination.id,
      ),
      params.destination,
    );

    if (params.idempotencyRecord) {
      const idemp = params.idempotencyRecord;
      const key = this.idempKey(idemp.principalId, idemp.keyHash);
      this.idempotency.set(key, {
        requestHash: new Uint8Array(idemp.requestHash),
        result: params.destination,
      });
    }

    return { destination: params.destination, cached: false };
  }

  async findAffiliateDestinationById(params: {
    readonly workspaceId: WorkspaceId;
    readonly productId: ProductId;
    readonly destinationId: AffiliateDestinationSnapshot['id'];
  }): Promise<AffiliateDestinationSnapshot | null> {
    return (
      this.affiliates.get(
        this.affiliateKey(params.workspaceId, params.productId, params.destinationId),
      ) ?? null
    );
  }

  async listAffiliateDestinations(
    params: ListAffiliateDestinationsPersistenceParams,
  ): Promise<ListAffiliateDestinationsPersistenceResult> {
    let all = Array.from(this.affiliates.values()).filter(
      (a) => a.workspaceId === params.workspaceId && a.productId === params.productId,
    );
    if (params.status) {
      all = all.filter((a) => a.status === params.status);
    }
    all.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));
    return { items: all.slice(0, params.limit), nextCursor: null };
  }

  async updateAffiliateDestination(
    params: UpdateAffiliateDestinationPersistenceParams,
  ): Promise<AffiliateDestinationSnapshot> {
    const existing = await this.findAffiliateDestinationById(params);
    if (!existing) {
      throw new AffiliateDestinationNotFoundError(params.destinationId);
    }
    if (existing.version !== params.expectedVersion) {
      throw new StaleVersionConflictError(params.expectedVersion, existing.version);
    }
    const updated: AffiliateDestinationSnapshot = {
      ...existing,
      label: params.updates.label,
      url: params.updates.url,
      networkName: params.updates.networkName,
      updatedAt: params.updates.updatedAt,
      version: existing.version + 1,
    };
    this.affiliates.set(
      this.affiliateKey(params.workspaceId, params.productId, params.destinationId),
      updated,
    );
    return updated;
  }

  async archiveAffiliateDestination(
    params: ArchiveAffiliateDestinationPersistenceParams,
  ): Promise<ArchiveAffiliateDestinationPersistenceResult> {
    const existing = await this.findAffiliateDestinationById(params);
    if (!existing) {
      throw new AffiliateDestinationNotFoundError(params.destinationId);
    }
    if (existing.status === 'archived') {
      return { destination: existing, alreadyArchived: true };
    }
    const archived: AffiliateDestinationSnapshot = {
      ...existing,
      status: 'archived',
      updatedAt: params.updatedAt,
      version: existing.version + 1,
    };
    this.affiliates.set(
      this.affiliateKey(params.workspaceId, params.productId, params.destinationId),
      archived,
    );
    return { destination: archived, alreadyArchived: false };
  }
}
