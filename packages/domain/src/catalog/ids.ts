import { DomainValidationError } from '../errors.js';
import { isValidUuidV7 } from '../ids.js';

declare const ProductIdBrand: unique symbol;
export type ProductId = string & { readonly [ProductIdBrand]: typeof ProductIdBrand };

declare const ProductFactSetIdBrand: unique symbol;
export type ProductFactSetId = string & {
  readonly [ProductFactSetIdBrand]: typeof ProductFactSetIdBrand;
};

declare const ProductFactIdBrand: unique symbol;
export type ProductFactId = string & {
  readonly [ProductFactIdBrand]: typeof ProductFactIdBrand;
};

declare const AffiliateDestinationIdBrand: unique symbol;
export type AffiliateDestinationId = string & {
  readonly [AffiliateDestinationIdBrand]: typeof AffiliateDestinationIdBrand;
};

function assertUuidV7(value: unknown, entityName: string, fieldName = 'id'): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError(`Invalid ${entityName} ID: must be a string`, fieldName);
  }
  if (!isValidUuidV7(value)) {
    throw new DomainValidationError(
      `Invalid ${entityName} ID: must be a canonical lowercase UUIDv7 string`,
      fieldName,
    );
  }
  return value;
}

export function isProductId(value: unknown): value is ProductId {
  return isValidUuidV7(value);
}

export function parseProductId(value: unknown, fieldName = 'productId'): ProductId {
  return assertUuidV7(value, 'product', fieldName) as ProductId;
}

export function isProductFactSetId(value: unknown): value is ProductFactSetId {
  return isValidUuidV7(value);
}

export function parseProductFactSetId(value: unknown, fieldName = 'factSetId'): ProductFactSetId {
  return assertUuidV7(value, 'product fact set', fieldName) as ProductFactSetId;
}

export function isProductFactId(value: unknown): value is ProductFactId {
  return isValidUuidV7(value);
}

export function parseProductFactId(value: unknown, fieldName = 'factId'): ProductFactId {
  return assertUuidV7(value, 'product fact', fieldName) as ProductFactId;
}

export function isAffiliateDestinationId(value: unknown): value is AffiliateDestinationId {
  return isValidUuidV7(value);
}

export function parseAffiliateDestinationId(
  value: unknown,
  fieldName = 'destinationId',
): AffiliateDestinationId {
  return assertUuidV7(value, 'affiliate destination', fieldName) as AffiliateDestinationId;
}
