import type {
  AffiliateDestinationDTO,
  AffiliateListResponse,
  AffiliateStatus,
} from '../types/catalog.js';
import {
  ApiError,
  hasExactOwnKeys,
  isPlainObject,
  isValidRfc3339DateTime,
  isValidUuidV7,
} from './api-validators-common.js';

const VALID_AFFILIATE_STATUSES = new Set<string>(['active', 'archived']);

const EXPECTED_AFFILIATE_BASE_KEYS = [
  'id',
  'workspaceId',
  'productId',
  'label',
  'url',
  'networkName',
  'status',
  'createdAt',
  'updatedAt',
  'version',
] as const;

function createMalformedError(detail: string): ApiError {
  return new ApiError(200, {
    status: 200,
    title: 'Malformed Response',
    detail,
  });
}

export function validateAffiliate(data: unknown): AffiliateDestinationDTO {
  if (!isPlainObject(data)) {
    throw createMalformedError('Affiliate destination must be a plain object');
  }
  if (Object.getOwnPropertySymbols(data).length > 0) {
    throw createMalformedError('Affiliate destination must not contain symbol properties');
  }

  const keys = Object.getOwnPropertyNames(data);
  const baseSet = new Set<string>(EXPECTED_AFFILIATE_BASE_KEYS);
  for (const key of EXPECTED_AFFILIATE_BASE_KEYS) {
    if (!keys.includes(key)) {
      throw createMalformedError(`Missing required affiliate field: ${key}`);
    }
  }
  for (const key of keys) {
    if (!baseSet.has(key) && key !== 'alreadyArchived') {
      throw createMalformedError(`Unexpected extra field in affiliate: ${key}`);
    }
  }

  if (
    !isValidUuidV7(data.id) ||
    !isValidUuidV7(data.workspaceId) ||
    !isValidUuidV7(data.productId)
  ) {
    throw createMalformedError('Affiliate id, workspaceId, and productId must be UUIDv7');
  }
  if (typeof data.label !== 'string' || typeof data.url !== 'string') {
    throw createMalformedError('Affiliate label and url must be strings');
  }
  if (data.label.length < 1 || data.label.length > 256) {
    throw createMalformedError('Affiliate label must contain 1 to 256 characters');
  }
  if (data.url.length < 1 || data.url.length > 2048) {
    throw createMalformedError('Affiliate url must contain 1 to 2048 characters');
  }
  if (
    data.networkName !== null &&
    (typeof data.networkName !== 'string' || data.networkName.length > 128)
  ) {
    throw createMalformedError(
      'Affiliate networkName must be a string of at most 128 characters or null',
    );
  }
  if (typeof data.status !== 'string' || !VALID_AFFILIATE_STATUSES.has(data.status)) {
    throw createMalformedError('Affiliate status must be active or archived');
  }
  if (!isValidRfc3339DateTime(data.createdAt) || !isValidRfc3339DateTime(data.updatedAt)) {
    throw createMalformedError('Affiliate createdAt and updatedAt must be RFC3339');
  }
  if (typeof data.version !== 'number' || !Number.isSafeInteger(data.version) || data.version < 1) {
    throw createMalformedError('Affiliate version must be positive integer');
  }
  if (keys.includes('alreadyArchived') && typeof data.alreadyArchived !== 'boolean') {
    throw createMalformedError('Affiliate alreadyArchived must be a boolean when present');
  }

  return {
    id: data.id,
    workspaceId: data.workspaceId,
    productId: data.productId,
    label: data.label,
    url: data.url,
    networkName: data.networkName,
    status: data.status as AffiliateStatus,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    version: data.version,
    ...(typeof data.alreadyArchived === 'boolean' ? { alreadyArchived: data.alreadyArchived } : {}),
  };
}

export function validateAffiliateListResponse(data: unknown): AffiliateListResponse {
  if (!isPlainObject(data) || !hasExactOwnKeys(data, ['items', 'page'])) {
    throw createMalformedError('Affiliate list response must have exact keys: items, page');
  }
  if (!Array.isArray(data.items)) {
    throw createMalformedError('Affiliate list items must be an array');
  }
  if (!isPlainObject(data.page) || !hasExactOwnKeys(data.page, ['nextCursor', 'hasMore'])) {
    throw createMalformedError('Affiliate list page must have exact keys: nextCursor, hasMore');
  }

  const nextCursor = data.page.nextCursor;
  if (
    nextCursor !== null &&
    (typeof nextCursor !== 'string' || nextCursor.length < 1 || nextCursor.length > 512)
  ) {
    throw createMalformedError(
      'Affiliate list nextCursor must be a non-empty bounded string or null',
    );
  }
  if (typeof data.page.hasMore !== 'boolean') {
    throw createMalformedError('Affiliate list hasMore must be a boolean');
  }
  if (data.page.hasMore !== (nextCursor !== null)) {
    throw createMalformedError('Affiliate list pagination fields are inconsistent');
  }

  return {
    items: data.items.map(validateAffiliate),
    page: { nextCursor, hasMore: data.page.hasMore },
  };
}
