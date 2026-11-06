export {
  isAffiliateDestinationId,
  isProductFactId,
  isProductFactSetId,
  isProductId,
  parseAffiliateDestinationId,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  type AffiliateDestinationId,
  type ProductFactId,
  type ProductFactSetId,
  type ProductId,
} from './ids.js';

export {
  AFFILIATE_DESTINATION_STATUSES,
  FACT_CLAIM_USAGES,
  FACT_CONFIDENCES,
  FACT_SET_STATUSES,
  FACT_SOURCE_TYPES,
  PRODUCT_STATUSES,
  isAffiliateDestinationStatus,
  isFactClaimUsage,
  isFactConfidence,
  isFactSetStatus,
  isFactSourceType,
  isProductStatus,
  type AffiliateDestinationSnapshot,
  type AffiliateDestinationStatus,
  type FactClaimUsage,
  type FactConfidence,
  type FactSetStatus,
  type FactSourceType,
  type ProductFactSetSnapshot,
  type ProductFactSnapshot,
  type ProductSnapshot,
  type ProductStatus,
} from './types.js';

export {
  assertNoCoercionHooks,
  assertPlainObject,
  getDataPropertyDescriptor,
  isProxySafe,
} from './safety.js';

export {
  computeCanonicalUrlHash,
  normalizeCanonicalProductUrl,
  redactAffiliateUrl,
  validateSafeHttpUrl,
} from './urls.js';

export {
  canTransitionAffiliateStatus,
  canTransitionFactSetStatus,
  canTransitionProductStatus,
} from './transitions.js';

export {
  validateAffiliateLabel,
  validateAffiliateNetworkName,
  validateAllowedClaimsNotes,
  validateAudienceNotes,
  validateCategory,
  validateDescription,
  validateFactKey,
  validateFactSetSummary,
  validateFactValue,
  validateMerchantName,
  validateProductName,
  validateProhibitedClaimsNotes,
  validateSourceExcerpt,
} from './validation.js';
