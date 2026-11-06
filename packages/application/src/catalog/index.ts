export {
  AffiliateDestinationNotFoundError,
  DuplicateFactKeyError,
  FactSetAlreadyConfirmedError,
  FactSetNotFoundError,
  ProductArchivedError,
  ProductNotFoundError,
  StaleVersionConflictError,
} from './errors.js';

export {
  decodeAffiliateCursor,
  decodeFactSetCursor,
  decodeProductCursor,
  encodeAffiliateCursor,
  encodeFactSetCursor,
  encodeProductCursor,
  type DecodedAffiliateCursor,
  type DecodedFactSetCursor,
  type DecodedProductCursor,
} from './cursor.js';

export {
  buildAffiliateAuditEvent,
  buildAffiliateCreateIdempotencyRecord,
  buildFactSetAuditEvent,
  buildFactSetCreateIdempotencyRecord,
  buildProductAuditEvent,
  buildProductCreateIdempotencyRecord,
  type CatalogAuditContext,
  type ProductCreateIdempotencyInput,
} from './helpers.js';

export type {
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
  UpdateAffiliateDestinationFields,
  UpdateAffiliateDestinationPersistenceParams,
  UpdateProductFields,
  UpdateProductPersistenceParams,
  UpdateProductPersistenceResult,
} from './ports.js';

export {
  createProduct,
  type CreateProductCommand,
  type CreateProductDependencies,
  type CreateProductResult,
} from './create-product.js';

export { getProduct, type GetProductCommand, type GetProductDependencies } from './get-product.js';

export {
  listProducts,
  type ListProductsCommand,
  type ListProductsDependencies,
  type ListProductsResult,
} from './list-products.js';

export {
  updateProduct,
  type UpdateProductCommand,
  type UpdateProductDependencies,
  type UpdateProductResult,
} from './update-product.js';

export {
  archiveProduct,
  type ArchiveProductCommand,
  type ArchiveProductDependencies,
  type ArchiveProductResult,
} from './archive-product.js';

export {
  createFactSet,
  type CreateFactSetCommand,
  type CreateFactSetDependencies,
  type CreateFactSetResult,
  type FactInput,
} from './create-fact-set.js';

export {
  getFactSet,
  type GetFactSetCommand,
  type GetFactSetDependencies,
  type GetFactSetResult,
} from './get-fact-set.js';

export {
  listFactSets,
  type ListFactSetsCommand,
  type ListFactSetsDependencies,
} from './list-fact-sets.js';

export {
  confirmFactSet,
  type ConfirmFactSetCommand,
  type ConfirmFactSetDependencies,
  type ConfirmFactSetResult,
} from './confirm-fact-set.js';

export {
  createAffiliateDestination,
  type CreateAffiliateDestinationCommand,
  type CreateAffiliateDestinationDependencies,
} from './create-affiliate-destination.js';

export {
  listAffiliateDestinations,
  type ListAffiliateDestinationsCommand,
  type ListAffiliateDestinationsDependencies,
} from './list-affiliate-destinations.js';

export {
  updateAffiliateDestination,
  type UpdateAffiliateDestinationCommand,
  type UpdateAffiliateDestinationDependencies,
} from './update-affiliate-destination.js';

export {
  archiveAffiliateDestination,
  type ArchiveAffiliateDestinationCommand,
  type ArchiveAffiliateDestinationDependencies,
  type ArchiveAffiliateDestinationResult,
} from './archive-affiliate-destination.js';
