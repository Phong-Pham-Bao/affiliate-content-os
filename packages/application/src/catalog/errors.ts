import { ApplicationError } from '../errors.js';

export class ProductNotFoundError extends ApplicationError {
  public override readonly name = 'ProductNotFoundError';
  public readonly code = 'PRODUCT_NOT_FOUND' as const;
  public readonly productId?: string | undefined;

  constructor(productId?: string) {
    super(productId ? `Product not found: ${productId}` : 'Product not found');
    this.productId = productId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class FactSetNotFoundError extends ApplicationError {
  public override readonly name = 'FactSetNotFoundError';
  public readonly code = 'FACT_SET_NOT_FOUND' as const;
  public readonly factSetId?: string | undefined;

  constructor(factSetId?: string) {
    super(factSetId ? `Fact set not found: ${factSetId}` : 'Fact set not found');
    this.factSetId = factSetId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AffiliateDestinationNotFoundError extends ApplicationError {
  public override readonly name = 'AffiliateDestinationNotFoundError';
  public readonly code = 'AFFILIATE_DESTINATION_NOT_FOUND' as const;
  public readonly destinationId?: string | undefined;

  constructor(destinationId?: string) {
    super(
      destinationId
        ? `Affiliate destination not found: ${destinationId}`
        : 'Affiliate destination not found',
    );
    this.destinationId = destinationId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class StaleVersionConflictError extends ApplicationError {
  public override readonly name = 'StaleVersionConflictError';
  public readonly code = 'STALE_VERSION_CONFLICT' as const;
  public readonly expectedVersion: number;
  public readonly actualVersion?: number | undefined;

  constructor(expectedVersion: number, actualVersion?: number) {
    super(
      actualVersion !== undefined
        ? `Resource version conflict: expected version ${expectedVersion}, but found version ${actualVersion}`
        : `Resource version conflict: expected version ${expectedVersion} does not match current version`,
    );
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DuplicateFactKeyError extends ApplicationError {
  public override readonly name = 'DuplicateFactKeyError';
  public readonly code = 'DUPLICATE_FACT_KEY' as const;
  public readonly factKey: string;

  constructor(factKey: string) {
    super(`Duplicate factKey within fact set: "${factKey}"`);
    this.factKey = factKey;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class FactSetAlreadyConfirmedError extends ApplicationError {
  public override readonly name = 'FactSetAlreadyConfirmedError';
  public readonly code = 'FACT_SET_ALREADY_CONFIRMED' as const;

  constructor() {
    super('Confirmed fact set is immutable and cannot be updated');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProductArchivedError extends ApplicationError {
  public override readonly name = 'ProductArchivedError';
  public readonly code = 'PRODUCT_ARCHIVED' as const;

  constructor() {
    super('Cannot perform this operation on an archived product');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
