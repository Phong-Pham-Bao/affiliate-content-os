import type {
  AffiliateDestinationId,
  AffiliateDestinationSnapshot,
  AuditEventSnapshot,
  ProductFactSetSnapshot,
  ProductFactSnapshot,
  ProductId,
  ProductSnapshot,
} from '@affiliate-content-os/domain';
import type {
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
  ArchiveAffiliateDestinationPersistenceParams,
  ArchiveAffiliateDestinationPersistenceResult,
  ArchiveProductPersistenceParams,
  ArchiveProductPersistenceResult,
} from '../../src/catalog/ports.js';
import {
  AffiliateDestinationNotFoundError,
  FactSetNotFoundError,
  ProductNotFoundError,
  StaleVersionConflictError,
} from '../../src/catalog/errors.js';
import { IdempotencyKeyReusedError } from '../../src/errors.js';
import crypto from 'node:crypto';

export class MockCatalogPersistence implements CatalogPersistencePort {
  public products = new Map<string, ProductSnapshot>();
  public factSets = new Map<string, ProductFactSetSnapshot>();
  public facts = new Map<string, ProductFactSnapshot[]>();
  public affiliateDestinations = new Map<string, AffiliateDestinationSnapshot>();
  public idempotencyKeys = new Map<
    string,
    { requestHash: Uint8Array; product: ProductSnapshot; duplicateWarning: boolean }
  >();
  public auditEvents: AuditEventSnapshot[] = [];

  private productKey(ws: string, id: string): string {
    return `${ws}:${id}`;
  }

  public async createProduct(
    params: CreateProductPersistenceParams,
  ): Promise<CreateProductPersistenceResult> {
    const idemKey = `${params.product.workspaceId}:${params.idempotencyRecord.routeKey}:${Buffer.from(params.idempotencyRecord.keyHash).toString('hex')}`;
    const existingIdem = this.idempotencyKeys.get(idemKey);
    if (existingIdem) {
      if (!crypto.timingSafeEqual(existingIdem.requestHash, params.idempotencyRecord.requestHash)) {
        throw new IdempotencyKeyReusedError();
      }
      return {
        product: existingIdem.product,
        idempotencyRecord: params.idempotencyRecord,
        duplicateWarning: existingIdem.duplicateWarning,
        cached: true,
      };
    }

    let duplicateWarning = false;
    for (const p of this.products.values()) {
      if (
        p.workspaceId === params.product.workspaceId &&
        crypto.timingSafeEqual(p.canonicalUrlHash, params.product.canonicalUrlHash)
      ) {
        duplicateWarning = true;
        break;
      }
    }

    this.products.set(
      this.productKey(params.product.workspaceId, params.product.id),
      params.product,
    );
    this.idempotencyKeys.set(idemKey, {
      requestHash: params.idempotencyRecord.requestHash,
      product: params.product,
      duplicateWarning,
    });
    this.auditEvents.push(params.auditEvent);

    return {
      product: params.product,
      idempotencyRecord: params.idempotencyRecord,
      duplicateWarning,
      cached: false,
    };
  }

  public async findProductById(params: {
    readonly workspaceId: string;
    readonly productId: ProductId;
  }): Promise<ProductSnapshot | null> {
    return this.products.get(this.productKey(params.workspaceId, params.productId)) ?? null;
  }

  public async findProductByCanonicalUrlHash(params: {
    readonly workspaceId: string;
    readonly canonicalUrlHash: Uint8Array;
    readonly excludeProductId?: ProductId | undefined;
  }): Promise<ProductSnapshot | null> {
    for (const p of this.products.values()) {
      if (
        p.workspaceId === params.workspaceId &&
        (!params.excludeProductId || p.id !== params.excludeProductId) &&
        crypto.timingSafeEqual(p.canonicalUrlHash, params.canonicalUrlHash)
      ) {
        return p;
      }
    }
    return null;
  }

  public async listProducts(
    params: ListProductsPersistenceParams,
  ): Promise<ListProductsPersistenceResult> {
    const items: ProductSnapshot[] = [];
    for (const p of this.products.values()) {
      if (p.workspaceId === params.workspaceId) {
        if (!params.status || p.status === params.status) {
          items.push(p);
        }
      }
    }
    return { items, nextCursor: null };
  }

  public async updateProduct(
    params: UpdateProductPersistenceParams,
  ): Promise<UpdateProductPersistenceResult> {
    const key = this.productKey(params.workspaceId, params.productId);
    const existing = this.products.get(key);
    if (!existing) {
      throw new ProductNotFoundError(params.productId);
    }
    if (existing.version !== params.expectedVersion) {
      throw new StaleVersionConflictError(params.expectedVersion, existing.version);
    }

    let duplicateWarning = false;
    for (const p of this.products.values()) {
      if (
        p.workspaceId === params.workspaceId &&
        p.id !== params.productId &&
        crypto.timingSafeEqual(p.canonicalUrlHash, params.updates.canonicalUrlHash)
      ) {
        duplicateWarning = true;
        break;
      }
    }

    const updated: ProductSnapshot = {
      ...existing,
      ...params.updates,
      version: existing.version + 1,
    };
    this.products.set(key, updated);
    this.auditEvents.push(params.auditEvent);
    return { product: updated, duplicateWarning };
  }

  public async archiveProduct(
    params: ArchiveProductPersistenceParams,
  ): Promise<ArchiveProductPersistenceResult> {
    const key = this.productKey(params.workspaceId, params.productId);
    const existing = this.products.get(key);
    if (!existing) {
      throw new ProductNotFoundError(params.productId);
    }
    if (existing.status === 'archived') {
      return { product: existing, alreadyArchived: true };
    }
    const updated: ProductSnapshot = {
      ...existing,
      status: 'archived',
      updatedAt: params.updatedAt,
      version: existing.version + 1,
    };
    this.products.set(key, updated);
    this.auditEvents.push(params.auditEvent);
    return { product: updated, alreadyArchived: false };
  }

  public async createFactSet(
    params: CreateFactSetPersistenceParams,
  ): Promise<CreateFactSetPersistenceResult> {
    let maxRev = 0;
    for (const fs of this.factSets.values()) {
      if (fs.productId === params.factSet.productId && fs.revisionNumber > maxRev) {
        maxRev = fs.revisionNumber;
      }
    }
    const nextRev = maxRev + 1;
    const fsWithRev: ProductFactSetSnapshot = {
      ...params.factSet,
      revisionNumber: nextRev,
    };
    this.factSets.set(this.productKey(params.factSet.workspaceId, params.factSet.id), fsWithRev);
    this.facts.set(this.productKey(params.factSet.workspaceId, params.factSet.id), [
      ...params.facts,
    ]);
    const finalAuditEvent: AuditEventSnapshot = {
      ...params.auditEvent,
      changes: {
        ...params.auditEvent.changes,
        revision_number: { before: null, after: String(nextRev) },
      },
    };
    this.auditEvents.push(finalAuditEvent);
    return { factSet: fsWithRev, facts: params.facts, cached: false };
  }

  public async findFactSetById(params: {
    readonly workspaceId: string;
    readonly productId: ProductId;
    readonly factSetId: string;
  }): Promise<FactSetWithFacts | null> {
    const fs = this.factSets.get(this.productKey(params.workspaceId, params.factSetId));
    if (!fs || fs.productId !== params.productId) return null;
    const f = this.facts.get(this.productKey(params.workspaceId, params.factSetId)) ?? [];
    return { factSet: fs, facts: f };
  }

  public async listFactSets(
    params: ListFactSetsPersistenceParams,
  ): Promise<ListFactSetsPersistenceResult> {
    const list: ProductFactSetSnapshot[] = [];
    for (const fs of this.factSets.values()) {
      if (fs.workspaceId === params.workspaceId && fs.productId === params.productId) {
        list.push(fs);
      }
    }
    list.sort((a, b) => b.revisionNumber - a.revisionNumber);
    const items = list.slice(0, params.limit);
    return { items, nextCursor: null };
  }

  public async confirmFactSet(
    params: ConfirmFactSetPersistenceParams,
  ): Promise<ConfirmFactSetPersistenceResult> {
    const fsKey = this.productKey(params.workspaceId, params.factSetId);
    const existingFs = this.factSets.get(fsKey);
    if (!existingFs) {
      throw new FactSetNotFoundError(params.factSetId);
    }
    const prodKey = this.productKey(params.workspaceId, params.productId);
    const prod = this.products.get(prodKey);
    if (!prod) {
      throw new ProductNotFoundError(params.productId);
    }
    if (existingFs.status === 'confirmed') {
      return { factSet: existingFs, product: prod, alreadyConfirmed: true };
    }
    const confirmedFs: ProductFactSetSnapshot = {
      ...existingFs,
      status: 'confirmed',
      confirmedByUserId: params.confirmedByUserId,
      confirmedAt: params.confirmedAt,
      updatedAt: params.confirmedAt,
      version: existingFs.version + 1,
    };
    this.factSets.set(fsKey, confirmedFs);
    const updatedProd: ProductSnapshot = {
      ...prod,
      currentFactSetId: params.factSetId,
      updatedAt: params.confirmedAt,
      version: prod.version + 1,
    };
    this.products.set(prodKey, updatedProd);
    this.auditEvents.push(params.auditEvent);
    return { factSet: confirmedFs, product: updatedProd, alreadyConfirmed: false };
  }

  public async createAffiliateDestination(
    params: CreateAffiliateDestinationPersistenceParams,
  ): Promise<CreateAffiliateDestinationPersistenceResult> {
    this.affiliateDestinations.set(
      this.productKey(params.destination.workspaceId, params.destination.id),
      params.destination,
    );
    this.auditEvents.push(params.auditEvent);
    return { destination: params.destination, cached: false };
  }

  public async findAffiliateDestinationById(params: {
    readonly workspaceId: string;
    readonly productId: ProductId;
    readonly destinationId: AffiliateDestinationId;
  }): Promise<AffiliateDestinationSnapshot | null> {
    const dest = this.affiliateDestinations.get(
      this.productKey(params.workspaceId, params.destinationId),
    );
    if (!dest || dest.productId !== params.productId) return null;
    return dest;
  }

  public async listAffiliateDestinations(
    params: ListAffiliateDestinationsPersistenceParams,
  ): Promise<ListAffiliateDestinationsPersistenceResult> {
    const list: AffiliateDestinationSnapshot[] = [];
    for (const d of this.affiliateDestinations.values()) {
      if (d.workspaceId === params.workspaceId && d.productId === params.productId) {
        if (!params.status || d.status === params.status) {
          list.push(d);
        }
      }
    }
    const items = list.slice(0, params.limit);
    return { items, nextCursor: null };
  }

  public async updateAffiliateDestination(
    params: UpdateAffiliateDestinationPersistenceParams,
  ): Promise<AffiliateDestinationSnapshot> {
    const key = this.productKey(params.workspaceId, params.destinationId);
    const existing = this.affiliateDestinations.get(key);
    if (!existing || existing.productId !== params.productId) {
      throw new AffiliateDestinationNotFoundError(params.destinationId);
    }
    if (existing.version !== params.expectedVersion) {
      throw new StaleVersionConflictError(params.expectedVersion, existing.version);
    }
    const updated: AffiliateDestinationSnapshot = {
      ...existing,
      ...params.updates,
      version: existing.version + 1,
    };
    this.affiliateDestinations.set(key, updated);
    this.auditEvents.push(params.auditEvent);
    return updated;
  }

  public async archiveAffiliateDestination(
    params: ArchiveAffiliateDestinationPersistenceParams,
  ): Promise<ArchiveAffiliateDestinationPersistenceResult> {
    const key = this.productKey(params.workspaceId, params.destinationId);
    const existing = this.affiliateDestinations.get(key);
    if (!existing || existing.productId !== params.productId) {
      throw new AffiliateDestinationNotFoundError(params.destinationId);
    }
    if (existing.status === 'archived') {
      return { destination: existing, alreadyArchived: true };
    }
    const updated: AffiliateDestinationSnapshot = {
      ...existing,
      status: 'archived',
      updatedAt: params.updatedAt,
      version: existing.version + 1,
    };
    this.affiliateDestinations.set(key, updated);
    this.auditEvents.push(params.auditEvent);
    return { destination: updated, alreadyArchived: false };
  }
}
