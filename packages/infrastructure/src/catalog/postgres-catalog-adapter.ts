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
} from '@affiliate-content-os/application';
import type {
  AffiliateDestinationId,
  AffiliateDestinationSnapshot,
  ProductId,
  ProductSnapshot,
} from '@affiliate-content-os/domain';
import type { Database } from '../database/types.js';
import {
  executeArchiveProductTransaction,
  executeCreateProductTransaction,
  executeUpdateProductTransaction,
} from './product-transactions.js';
import {
  executeConfirmFactSetTransaction,
  executeCreateFactSetTransaction,
} from './fact-set-transactions.js';
import {
  executeArchiveAffiliateTransaction,
  executeCreateAffiliateTransaction,
  executeUpdateAffiliateTransaction,
} from './affiliate-transactions.js';
import {
  queryAffiliateDestinationById,
  queryFactSetById,
  queryListAffiliateDestinations,
  queryListFactSets,
  queryListProducts,
  queryProductByCanonicalUrlHash,
  queryProductById,
} from './catalog-queries.js';

export class PostgresCatalogAdapter implements CatalogPersistencePort {
  constructor(private readonly database: Database) {}

  public async createProduct(
    params: CreateProductPersistenceParams,
  ): Promise<CreateProductPersistenceResult> {
    return this.database.withTransaction((tx) => executeCreateProductTransaction(tx, params));
  }

  public async findProductById(params: {
    readonly workspaceId: string;
    readonly productId: ProductId;
  }): Promise<ProductSnapshot | null> {
    return queryProductById(this.database, params.workspaceId, params.productId);
  }

  public async findProductByCanonicalUrlHash(params: {
    readonly workspaceId: string;
    readonly canonicalUrlHash: Uint8Array;
    readonly excludeProductId?: ProductId | undefined;
  }): Promise<ProductSnapshot | null> {
    return queryProductByCanonicalUrlHash(
      this.database,
      params.workspaceId,
      params.canonicalUrlHash,
      params.excludeProductId,
    );
  }

  public async listProducts(
    params: ListProductsPersistenceParams,
  ): Promise<ListProductsPersistenceResult> {
    return queryListProducts(this.database, params);
  }

  public async updateProduct(
    params: UpdateProductPersistenceParams,
  ): Promise<UpdateProductPersistenceResult> {
    return this.database.withTransaction((tx) => executeUpdateProductTransaction(tx, params));
  }

  public async archiveProduct(
    params: ArchiveProductPersistenceParams,
  ): Promise<ArchiveProductPersistenceResult> {
    return this.database.withTransaction((tx) => executeArchiveProductTransaction(tx, params));
  }

  public async createFactSet(
    params: CreateFactSetPersistenceParams,
  ): Promise<CreateFactSetPersistenceResult> {
    return this.database.withTransaction((tx) => executeCreateFactSetTransaction(tx, params));
  }

  public async findFactSetById(params: {
    readonly workspaceId: string;
    readonly productId: ProductId;
    readonly factSetId: string;
  }): Promise<FactSetWithFacts | null> {
    return queryFactSetById(this.database, params.workspaceId, params.productId, params.factSetId);
  }

  public async listFactSets(
    params: ListFactSetsPersistenceParams,
  ): Promise<ListFactSetsPersistenceResult> {
    return queryListFactSets(this.database, params);
  }

  public async confirmFactSet(
    params: ConfirmFactSetPersistenceParams,
  ): Promise<ConfirmFactSetPersistenceResult> {
    return this.database.withTransaction((tx) => executeConfirmFactSetTransaction(tx, params));
  }

  public async createAffiliateDestination(
    params: CreateAffiliateDestinationPersistenceParams,
  ): Promise<CreateAffiliateDestinationPersistenceResult> {
    return this.database.withTransaction((tx) => executeCreateAffiliateTransaction(tx, params));
  }

  public async findAffiliateDestinationById(params: {
    readonly workspaceId: string;
    readonly productId: ProductId;
    readonly destinationId: AffiliateDestinationId;
  }): Promise<AffiliateDestinationSnapshot | null> {
    return queryAffiliateDestinationById(
      this.database,
      params.workspaceId,
      params.productId,
      params.destinationId,
    );
  }

  public async listAffiliateDestinations(
    params: ListAffiliateDestinationsPersistenceParams,
  ): Promise<ListAffiliateDestinationsPersistenceResult> {
    return queryListAffiliateDestinations(this.database, params);
  }

  public async updateAffiliateDestination(
    params: UpdateAffiliateDestinationPersistenceParams,
  ): Promise<AffiliateDestinationSnapshot> {
    return this.database.withTransaction((tx) => executeUpdateAffiliateTransaction(tx, params));
  }

  public async archiveAffiliateDestination(
    params: ArchiveAffiliateDestinationPersistenceParams,
  ): Promise<ArchiveAffiliateDestinationPersistenceResult> {
    return this.database.withTransaction((tx) => executeArchiveAffiliateTransaction(tx, params));
  }
}
