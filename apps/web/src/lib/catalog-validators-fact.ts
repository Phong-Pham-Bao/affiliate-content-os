import type {
  ConfirmFactSetResponse,
  FactClaimUsage,
  FactConfidence,
  FactDTO,
  FactSetDetailResponse,
  FactSetDTO,
  FactSetListResponse,
  FactSetStatus,
  FactSourceType,
} from '../types/catalog.js';
import {
  ApiError,
  hasExactOwnKeys,
  isPlainObject,
  isValidRfc3339DateTime,
  isValidUuidV7,
} from './api-validators-common.js';
import { validateProduct } from './catalog-validators-product.js';

const EXPECTED_FACT_SET_KEYS = [
  'id',
  'workspaceId',
  'productId',
  'revisionNumber',
  'status',
  'summary',
  'confirmedByUserId',
  'confirmedAt',
  'createdByUserId',
  'createdAt',
  'updatedAt',
  'version',
] as const;

const EXPECTED_FACT_KEYS = [
  'id',
  'workspaceId',
  'productId',
  'factSetId',
  'factKey',
  'valueText',
  'sourceType',
  'sourceUrl',
  'sourceExcerpt',
  'confidence',
  'claimUsage',
  'createdAt',
] as const;

const FACT_KEY_REGEX = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

function createMalformedError(detail: string): ApiError {
  return new ApiError(200, {
    status: 200,
    title: 'Malformed Response',
    detail,
  });
}

function isFactSetStatus(val: unknown): val is FactSetStatus {
  return val === 'proposed' || val === 'confirmed';
}

function isFactSourceType(val: unknown): val is FactSourceType {
  return val === 'user' || val === 'merchant_page' || val === 'document' || val === 'other';
}

function isFactConfidence(val: unknown): val is FactConfidence {
  return val === 'confirmed' || val === 'suggested' || val === 'uncertain';
}

function isFactClaimUsage(val: unknown): val is FactClaimUsage {
  return val === 'allowed' || val === 'context_only' || val === 'prohibited';
}

export function validateFactSet(data: unknown): FactSetDTO {
  if (!isPlainObject(data)) {
    throw createMalformedError('Fact set must be a plain object');
  }
  if (!hasExactOwnKeys(data, EXPECTED_FACT_SET_KEYS)) {
    throw createMalformedError('Fact set has unexpected, missing, or extra keys');
  }

  const {
    id,
    workspaceId,
    productId,
    revisionNumber,
    status,
    summary,
    confirmedByUserId,
    confirmedAt,
    createdByUserId,
    createdAt,
    updatedAt,
    version,
  } = data;

  if (
    !isValidUuidV7(id) ||
    !isValidUuidV7(workspaceId) ||
    !isValidUuidV7(productId) ||
    !isValidUuidV7(createdByUserId)
  ) {
    throw createMalformedError(
      'Fact set id, workspaceId, productId, and createdByUserId must be UUIDv7',
    );
  }

  if (
    typeof revisionNumber !== 'number' ||
    !Number.isSafeInteger(revisionNumber) ||
    revisionNumber < 1
  ) {
    throw createMalformedError('Fact set revisionNumber must be positive safe integer');
  }

  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw createMalformedError('Fact set version must be positive safe integer');
  }

  if (!isFactSetStatus(status)) {
    throw createMalformedError('Fact set status must be proposed or confirmed');
  }

  if (summary !== null && (typeof summary !== 'string' || summary.length > 2048)) {
    throw createMalformedError('Fact set summary must be null or string up to 2048 characters');
  }

  if (status === 'confirmed') {
    if (confirmedByUserId === null || !isValidUuidV7(confirmedByUserId)) {
      throw createMalformedError('Confirmed fact set confirmedByUserId must be UUIDv7');
    }
    if (confirmedAt === null || !isValidRfc3339DateTime(confirmedAt)) {
      throw createMalformedError('Confirmed fact set confirmedAt must be RFC3339');
    }
  } else {
    if (confirmedByUserId !== null || confirmedAt !== null) {
      throw createMalformedError(
        'Proposed fact set confirmedByUserId and confirmedAt must be null',
      );
    }
  }

  if (!isValidRfc3339DateTime(createdAt) || !isValidRfc3339DateTime(updatedAt)) {
    throw createMalformedError('Fact set createdAt and updatedAt must be RFC3339');
  }

  return {
    id,
    workspaceId,
    productId,
    revisionNumber,
    status,
    summary,
    confirmedByUserId,
    confirmedAt,
    createdByUserId,
    createdAt,
    updatedAt,
    version,
  };
}

export function validateFact(data: unknown): FactDTO {
  if (!isPlainObject(data)) {
    throw createMalformedError('Fact must be a plain object');
  }
  if (!hasExactOwnKeys(data, EXPECTED_FACT_KEYS)) {
    throw createMalformedError('Fact has unexpected, missing, or extra keys');
  }

  const {
    id,
    workspaceId,
    productId,
    factSetId,
    factKey,
    valueText,
    sourceType,
    sourceUrl,
    sourceExcerpt,
    confidence,
    claimUsage,
    createdAt,
  } = data;

  if (
    !isValidUuidV7(id) ||
    !isValidUuidV7(workspaceId) ||
    !isValidUuidV7(productId) ||
    !isValidUuidV7(factSetId)
  ) {
    throw createMalformedError('Fact id, workspaceId, productId, and factSetId must be UUIDv7');
  }

  if (typeof factKey !== 'string' || factKey.length > 128 || !FACT_KEY_REGEX.test(factKey)) {
    throw createMalformedError(
      'Fact factKey must match pattern /^[a-z0-9]+([._-][a-z0-9]+)*$/ with length up to 128',
    );
  }

  if (typeof valueText !== 'string' || valueText.length < 1 || valueText.length > 10000) {
    throw createMalformedError('Fact valueText must be a string between 1 and 10000 characters');
  }

  if (!isFactSourceType(sourceType)) {
    throw createMalformedError('Fact sourceType must be user, merchant_page, document, or other');
  }

  if (sourceUrl !== null && (typeof sourceUrl !== 'string' || sourceUrl.length > 2048)) {
    throw createMalformedError('Fact sourceUrl must be null or string up to 2048 characters');
  }

  if (
    sourceExcerpt !== null &&
    (typeof sourceExcerpt !== 'string' || sourceExcerpt.length > 2048)
  ) {
    throw createMalformedError('Fact sourceExcerpt must be null or string up to 2048 characters');
  }

  if (!isFactConfidence(confidence)) {
    throw createMalformedError('Fact confidence must be confirmed, suggested, or uncertain');
  }

  if (!isFactClaimUsage(claimUsage)) {
    throw createMalformedError('Fact claimUsage must be allowed, context_only, or prohibited');
  }

  if (!isValidRfc3339DateTime(createdAt)) {
    throw createMalformedError('Fact createdAt must be RFC3339 date');
  }

  return {
    id,
    workspaceId,
    productId,
    factSetId,
    factKey,
    valueText,
    sourceType,
    sourceUrl,
    sourceExcerpt,
    confidence,
    claimUsage,
    createdAt,
  };
}

export function validateFactSetListResponse(data: unknown): FactSetListResponse {
  if (!isPlainObject(data) || !hasExactOwnKeys(data, ['items', 'page'])) {
    throw createMalformedError('FactSet list response must have exact keys: items, page');
  }
  if (!Array.isArray(data.items)) {
    throw createMalformedError('FactSet list items must be an array');
  }
  if (!isPlainObject(data.page) || !hasExactOwnKeys(data.page, ['nextCursor', 'hasMore'])) {
    throw createMalformedError('FactSet list page must have exact keys: nextCursor, hasMore');
  }

  const { nextCursor, hasMore } = data.page;

  if (
    nextCursor !== null &&
    (typeof nextCursor !== 'string' || nextCursor.length < 1 || nextCursor.length > 512)
  ) {
    throw createMalformedError(
      'FactSet list page nextCursor must be null or a non-empty string up to 512 characters',
    );
  }

  if (typeof hasMore !== 'boolean') {
    throw createMalformedError('FactSet list page hasMore must be a boolean');
  }

  if (hasMore !== (nextCursor !== null)) {
    throw createMalformedError('FactSet list page hasMore must match nextCursor presence');
  }

  return {
    items: data.items.map(validateFactSet),
    page: {
      nextCursor,
      hasMore,
    },
  };
}

export function validateFactSetDetailResponse(data: unknown): FactSetDetailResponse {
  if (!isPlainObject(data) || !hasExactOwnKeys(data, ['factSet', 'facts'])) {
    throw createMalformedError('FactSet detail response must have exact keys: factSet, facts');
  }
  if (!Array.isArray(data.facts)) {
    throw createMalformedError('FactSet detail facts must be an array');
  }

  return {
    factSet: validateFactSet(data.factSet),
    facts: data.facts.map(validateFact),
  };
}

export function validateConfirmFactSetResponse(data: unknown): ConfirmFactSetResponse {
  if (!isPlainObject(data) || !hasExactOwnKeys(data, ['factSet', 'product', 'alreadyConfirmed'])) {
    throw createMalformedError(
      'Confirm fact set response must have exact keys: factSet, product, alreadyConfirmed',
    );
  }

  const alreadyConfirmed = data.alreadyConfirmed;
  if (typeof alreadyConfirmed !== 'boolean') {
    throw createMalformedError('Confirm fact set response alreadyConfirmed must be a boolean');
  }

  return {
    factSet: validateFactSet(data.factSet),
    product: validateProduct(data.product),
    alreadyConfirmed,
  };
}
