import type { ProductDTO, ProductListResponse, ProductStatus } from '../types/catalog.js';
import {
  ApiError,
  hasExactOwnKeys,
  isPlainObject,
  isValidRfc3339DateTime,
  isValidUuidV7,
} from './api-validators-common.js';

const EXPECTED_PRODUCT_BASE_KEYS = [
  'id',
  'workspaceId',
  'name',
  'merchantName',
  'canonicalUrl',
  'category',
  'description',
  'audienceNotes',
  'allowedClaimsNotes',
  'prohibitedClaimsNotes',
  'status',
  'currentFactSetId',
  'createdAt',
  'updatedAt',
  'version',
] as const;

function isProductStatus(val: unknown): val is ProductStatus {
  return val === 'draft' || val === 'active' || val === 'archived';
}

function createMalformedError(detail: string): ApiError {
  return new ApiError(200, {
    status: 200,
    title: 'Malformed Response',
    detail,
  });
}

function validateBoundedString(val: unknown, min: number, max: number, label: string): string {
  if (typeof val !== 'string' || val.length < min || val.length > max) {
    throw createMalformedError(
      `Product ${label} must be a string between ${min} and ${max} characters`,
    );
  }
  return val;
}

function validateOptionalBoundedString(val: unknown, max: number, label: string): string | null {
  if (val !== null && (typeof val !== 'string' || val.length > max)) {
    throw createMalformedError(`Product ${label} must be null or string up to ${max} characters`);
  }
  return val;
}

export function validateProduct(data: unknown): ProductDTO {
  if (!isPlainObject(data)) {
    throw createMalformedError('Product must be a plain object');
  }

  if (Object.getOwnPropertySymbols(data).length > 0) {
    throw createMalformedError('Product must not contain symbol properties');
  }

  const keys = Object.getOwnPropertyNames(data);
  const baseSet = new Set<string>(EXPECTED_PRODUCT_BASE_KEYS);
  for (const key of EXPECTED_PRODUCT_BASE_KEYS) {
    if (!keys.includes(key)) {
      throw createMalformedError(`Missing required product field: ${key}`);
    }
  }
  for (const key of keys) {
    if (!baseSet.has(key) && key !== 'duplicateWarning' && key !== 'alreadyArchived') {
      throw createMalformedError(`Unexpected extra field in product: ${key}`);
    }
  }

  if (!isValidUuidV7(data.id) || !isValidUuidV7(data.workspaceId)) {
    throw createMalformedError('Product id and workspaceId must be valid UUIDv7');
  }

  const name = validateBoundedString(data.name, 1, 256, 'name');
  const merchantName = validateBoundedString(data.merchantName, 1, 256, 'merchantName');
  const canonicalUrl = validateBoundedString(data.canonicalUrl, 1, 2048, 'canonicalUrl');
  const category = validateBoundedString(data.category, 1, 128, 'category');
  const description = validateBoundedString(data.description, 1, 10000, 'description');

  const audienceNotes = validateOptionalBoundedString(data.audienceNotes, 5000, 'audienceNotes');
  const allowedClaimsNotes = validateOptionalBoundedString(
    data.allowedClaimsNotes,
    5000,
    'allowedClaimsNotes',
  );
  const prohibitedClaimsNotes = validateOptionalBoundedString(
    data.prohibitedClaimsNotes,
    5000,
    'prohibitedClaimsNotes',
  );

  if (!isProductStatus(data.status)) {
    throw createMalformedError('Product status must be draft, active, or archived');
  }

  if (data.currentFactSetId !== null && !isValidUuidV7(data.currentFactSetId)) {
    throw createMalformedError('Product currentFactSetId must be UUIDv7 or null');
  }

  if (!isValidRfc3339DateTime(data.createdAt) || !isValidRfc3339DateTime(data.updatedAt)) {
    throw createMalformedError('Product createdAt and updatedAt must be RFC3339 dates');
  }

  if (typeof data.version !== 'number' || !Number.isSafeInteger(data.version) || data.version < 1) {
    throw createMalformedError('Product version must be a positive safe integer');
  }

  if (
    (keys.includes('duplicateWarning') || data.duplicateWarning !== undefined) &&
    typeof data.duplicateWarning !== 'boolean'
  ) {
    throw createMalformedError('Product duplicateWarning must be a boolean');
  }

  if (
    (keys.includes('alreadyArchived') || data.alreadyArchived !== undefined) &&
    typeof data.alreadyArchived !== 'boolean'
  ) {
    throw createMalformedError('Product alreadyArchived must be a boolean');
  }

  return {
    id: data.id,
    workspaceId: data.workspaceId,
    name,
    merchantName,
    canonicalUrl,
    category,
    description,
    audienceNotes,
    allowedClaimsNotes,
    prohibitedClaimsNotes,
    status: data.status,
    currentFactSetId: data.currentFactSetId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    version: data.version,
    ...(typeof data.duplicateWarning === 'boolean'
      ? { duplicateWarning: data.duplicateWarning }
      : {}),
    ...(typeof data.alreadyArchived === 'boolean' ? { alreadyArchived: data.alreadyArchived } : {}),
  };
}

export function validateProductListResponse(data: unknown): ProductListResponse {
  if (!isPlainObject(data)) {
    throw createMalformedError('Product list response must be a plain object');
  }
  if (!hasExactOwnKeys(data, ['items', 'page'])) {
    throw createMalformedError('Product list response must have exact keys: items, page');
  }
  if (!Array.isArray(data.items)) {
    throw createMalformedError('Product list items must be an array');
  }
  if (!isPlainObject(data.page) || !hasExactOwnKeys(data.page, ['nextCursor', 'hasMore'])) {
    throw createMalformedError('Product list page must have exact keys: nextCursor, hasMore');
  }

  const nextCursor = data.page.nextCursor;
  if (
    nextCursor !== null &&
    (typeof nextCursor !== 'string' || nextCursor.length < 1 || nextCursor.length > 512)
  ) {
    throw createMalformedError(
      'Product list page nextCursor must be null or a non-empty string up to 512 characters',
    );
  }

  const hasMore = data.page.hasMore;
  if (typeof hasMore !== 'boolean') {
    throw createMalformedError('Product list page hasMore must be a boolean');
  }

  if (hasMore !== (nextCursor !== null)) {
    throw createMalformedError('Product list page hasMore must match nextCursor presence');
  }

  const items = data.items.map(validateProduct);

  return {
    items,
    page: { nextCursor, hasMore },
  };
}
