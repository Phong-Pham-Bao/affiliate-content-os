import {
  parseAffiliateDestinationId,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  parseWorkspaceId,
  AFFILIATE_DESTINATION_STATUSES,
  FACT_CLAIM_USAGES,
  FACT_CONFIDENCES,
  FACT_SOURCE_TYPES,
  type AffiliateDestinationSnapshot,
  type AffiliateDestinationStatus,
  type FactClaimUsage,
  type FactConfidence,
  type FactSourceType,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import {
  extractOwnRowProperties,
  mapSafeTimestamp,
  validateBoundedString,
  validateEnum,
  validateOptionalBoundedString,
  validateSafeUrl,
  validateSafeVersion,
  validateUuid,
} from './mapper-helpers.js';

const FACT_COLS = [
  'id',
  'workspace_id',
  'product_id',
  'fact_set_id',
  'fact_key',
  'value_text',
  'source_type',
  'source_url',
  'source_excerpt',
  'confidence',
  'claim_usage',
  'created_at',
] as const;

export function validateAndMapProductFactRow(row: unknown): ProductFactSnapshot {
  const v = extractOwnRowProperties(row, FACT_COLS);
  const factKey = validateBoundedString(v['fact_key'], 'fact.fact_key', 1, 128);
  if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(factKey)) {
    throw new DatabaseError('Corrupt database row: invalid fact_key format');
  }

  const rawSourceUrl = v['source_url'];
  const sourceUrl =
    rawSourceUrl !== null && rawSourceUrl !== undefined
      ? validateSafeUrl(rawSourceUrl, 'fact.source_url')
      : null;

  return Object.freeze({
    id: parseProductFactId(validateUuid(v['id'], 'fact.id')),
    workspaceId: parseWorkspaceId(validateUuid(v['workspace_id'], 'fact.workspace_id')),
    productId: parseProductId(validateUuid(v['product_id'], 'fact.product_id')),
    factSetId: parseProductFactSetId(validateUuid(v['fact_set_id'], 'fact.fact_set_id')),
    factKey,
    valueText: validateBoundedString(v['value_text'], 'fact.value_text', 1, 10000, true),
    sourceType: validateEnum<FactSourceType>(
      v['source_type'],
      'fact.source_type',
      FACT_SOURCE_TYPES,
    ),
    sourceUrl,
    sourceExcerpt: validateOptionalBoundedString(
      v['source_excerpt'],
      'fact.source_excerpt',
      2048,
      true,
    ),
    confidence: validateEnum<FactConfidence>(v['confidence'], 'fact.confidence', FACT_CONFIDENCES),
    claimUsage: validateEnum<FactClaimUsage>(
      v['claim_usage'],
      'fact.claim_usage',
      FACT_CLAIM_USAGES,
    ),
    createdAt: mapSafeTimestamp(v['created_at'], 'fact.created_at'),
  });
}

const AFFILIATE_COLS = [
  'id',
  'workspace_id',
  'product_id',
  'label',
  'url',
  'network_name',
  'status',
  'created_at',
  'updated_at',
  'version',
] as const;

export function validateAndMapAffiliateDestinationRow(row: unknown): AffiliateDestinationSnapshot {
  const v = extractOwnRowProperties(row, AFFILIATE_COLS);
  const createdAt = mapSafeTimestamp(v['created_at'], 'affiliate.created_at');
  const updatedAt = mapSafeTimestamp(v['updated_at'], 'affiliate.updated_at');
  if (new Date(updatedAt).getTime() < new Date(createdAt).getTime()) {
    throw new DatabaseError('Corrupt database row: updated_at precedes created_at');
  }

  return Object.freeze({
    id: parseAffiliateDestinationId(validateUuid(v['id'], 'affiliate.id')),
    workspaceId: parseWorkspaceId(validateUuid(v['workspace_id'], 'affiliate.workspace_id')),
    productId: parseProductId(validateUuid(v['product_id'], 'affiliate.product_id')),
    label: validateBoundedString(v['label'], 'affiliate.label', 1, 256),
    url: validateSafeUrl(v['url'], 'affiliate.url'),
    networkName: validateOptionalBoundedString(v['network_name'], 'affiliate.network_name', 128),
    status: validateEnum<AffiliateDestinationStatus>(
      v['status'],
      'affiliate.status',
      AFFILIATE_DESTINATION_STATUSES,
    ),
    createdAt,
    updatedAt,
    version: validateSafeVersion(v['version'], 'affiliate.version'),
  });
}
