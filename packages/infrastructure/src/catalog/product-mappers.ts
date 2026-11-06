import {
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  FACT_SET_STATUSES,
  PRODUCT_STATUSES,
  type FactSetStatus,
  type ProductFactSetSnapshot,
  type ProductSnapshot,
  type ProductStatus,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import {
  extractOwnRowProperties,
  mapSafeTimestamp,
  validateAndCopy32ByteHash,
  validateBoundedString,
  validateEnum,
  validateOptionalBoundedString,
  validateSafeRevision,
  validateSafeUrl,
  validateSafeVersion,
  validateUuid,
} from './mapper-helpers.js';

const PRODUCT_COLS = [
  'id',
  'workspace_id',
  'name',
  'merchant_name',
  'canonical_url',
  'canonical_url_hash',
  'category',
  'description',
  'audience_notes',
  'allowed_claims_notes',
  'prohibited_claims_notes',
  'status',
  'current_fact_set_id',
  'created_at',
  'updated_at',
  'version',
] as const;

export function validateAndMapProductRow(row: unknown): ProductSnapshot {
  const v = extractOwnRowProperties(row, PRODUCT_COLS);
  const createdAt = mapSafeTimestamp(v['created_at'], 'product.created_at');
  const updatedAt = mapSafeTimestamp(v['updated_at'], 'product.updated_at');
  if (new Date(updatedAt).getTime() < new Date(createdAt).getTime()) {
    throw new DatabaseError('Corrupt database row: updated_at precedes created_at');
  }

  const rawFactSetId = v['current_fact_set_id'];
  const currentFactSetId =
    rawFactSetId !== null && rawFactSetId !== undefined
      ? parseProductFactSetId(validateUuid(rawFactSetId, 'product.current_fact_set_id'))
      : null;

  return Object.freeze({
    id: parseProductId(validateUuid(v['id'], 'product.id')),
    workspaceId: parseWorkspaceId(validateUuid(v['workspace_id'], 'product.workspace_id')),
    name: validateBoundedString(v['name'], 'product.name', 1, 256),
    merchantName: validateBoundedString(v['merchant_name'], 'product.merchant_name', 1, 256),
    canonicalUrl: validateSafeUrl(v['canonical_url'], 'product.canonical_url'),
    canonicalUrlHash: validateAndCopy32ByteHash(
      v['canonical_url_hash'],
      'product.canonical_url_hash',
    ),
    category: validateBoundedString(v['category'], 'product.category', 1, 128),
    description: validateBoundedString(v['description'], 'product.description', 1, 10000, true),
    audienceNotes: validateOptionalBoundedString(
      v['audience_notes'],
      'product.audience_notes',
      5000,
      true,
    ),
    allowedClaimsNotes: validateOptionalBoundedString(
      v['allowed_claims_notes'],
      'product.allowed_claims_notes',
      5000,
      true,
    ),
    prohibitedClaimsNotes: validateOptionalBoundedString(
      v['prohibited_claims_notes'],
      'product.prohibited_claims_notes',
      5000,
      true,
    ),
    status: validateEnum<ProductStatus>(v['status'], 'product.status', PRODUCT_STATUSES),
    currentFactSetId,
    createdAt,
    updatedAt,
    version: validateSafeVersion(v['version'], 'product.version'),
  });
}

const FACT_SET_COLS = [
  'id',
  'workspace_id',
  'product_id',
  'revision_number',
  'status',
  'summary',
  'created_by_user_id',
  'confirmed_by_user_id',
  'confirmed_at',
  'created_at',
  'updated_at',
  'version',
] as const;

export function validateAndMapProductFactSetRow(row: unknown): ProductFactSetSnapshot {
  const v = extractOwnRowProperties(row, FACT_SET_COLS);
  const createdAt = mapSafeTimestamp(v['created_at'], 'fact_set.created_at');
  const updatedAt = mapSafeTimestamp(v['updated_at'], 'fact_set.updated_at');
  if (new Date(updatedAt).getTime() < new Date(createdAt).getTime()) {
    throw new DatabaseError('Corrupt database row: updated_at precedes created_at');
  }

  const status = validateEnum<FactSetStatus>(v['status'], 'fact_set.status', FACT_SET_STATUSES);
  const revisionNumber = validateSafeRevision(v['revision_number'], 'fact_set.revision_number');

  let confirmedByUserId = null;
  let confirmedAt = null;
  if (status === 'confirmed') {
    if (v['confirmed_by_user_id'] === null || v['confirmed_at'] === null) {
      throw new DatabaseError('Corrupt database row: confirmed fact set missing confirmation data');
    }
    confirmedByUserId = parseUserId(
      validateUuid(v['confirmed_by_user_id'], 'fact_set.confirmed_by_user_id'),
    );
    confirmedAt = mapSafeTimestamp(v['confirmed_at'], 'fact_set.confirmed_at');
    if (new Date(confirmedAt).getTime() < new Date(createdAt).getTime()) {
      throw new DatabaseError('Corrupt database row: confirmed_at precedes created_at');
    }
  } else if (v['confirmed_by_user_id'] !== null || v['confirmed_at'] !== null) {
    throw new DatabaseError('Corrupt database row: proposed fact set has confirmation data');
  }

  return Object.freeze({
    id: parseProductFactSetId(validateUuid(v['id'], 'fact_set.id')),
    workspaceId: parseWorkspaceId(validateUuid(v['workspace_id'], 'fact_set.workspace_id')),
    productId: parseProductId(validateUuid(v['product_id'], 'fact_set.product_id')),
    revisionNumber,
    status,
    summary: validateOptionalBoundedString(v['summary'], 'fact_set.summary', 2048, true),
    createdByUserId: parseUserId(
      validateUuid(v['created_by_user_id'], 'fact_set.created_by_user_id'),
    ),
    confirmedByUserId,
    confirmedAt,
    createdAt,
    updatedAt,
    version: validateSafeVersion(v['version'], 'fact_set.version'),
  });
}
