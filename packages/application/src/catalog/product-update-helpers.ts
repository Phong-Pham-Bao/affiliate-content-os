import {
  canTransitionProductStatus,
  computeCanonicalUrlHash,
  isProductStatus,
  normalizeCanonicalProductUrl,
  validateAllowedClaimsNotes,
  validateAudienceNotes,
  validateCategory,
  validateDescription,
  validateMerchantName,
  validateProductName,
  validateProhibitedClaimsNotes,
  type AuditScalarChange,
  type IsoTimestamp,
  type ProductSnapshot,
  type ProductStatus,
} from '@affiliate-content-os/domain';
import { ValidationError } from '../errors.js';
import type { SnappedUpdateProductCommand } from './command-snapshots.js';
import type { UpdateProductFields } from './ports.js';

export function computeProductUpdatesAndAuditChanges(params: {
  readonly existing: ProductSnapshot;
  readonly snap: SnappedUpdateProductCommand;
  readonly now: IsoTimestamp;
}): {
  readonly updates: UpdateProductFields;
  readonly changes: Record<string, AuditScalarChange>;
} {
  const { existing, snap, now } = params;
  const changes: Record<string, AuditScalarChange> = {};

  let updatedName = existing.name;
  if (snap.name !== undefined) {
    updatedName = validateProductName(snap.name);
    if (updatedName !== existing.name) {
      changes.name = { before: existing.name, after: updatedName };
    }
  }

  let updatedMerchant = existing.merchantName;
  if (snap.merchantName !== undefined) {
    updatedMerchant = validateMerchantName(snap.merchantName);
    if (updatedMerchant !== existing.merchantName) {
      changes.merchant_name = { before: existing.merchantName, after: updatedMerchant };
    }
  }

  let updatedCanonicalUrl = existing.canonicalUrl;
  let updatedCanonicalHash = existing.canonicalUrlHash;
  if (snap.canonicalUrl !== undefined) {
    const normalized = normalizeCanonicalProductUrl(snap.canonicalUrl);
    const newHash = computeCanonicalUrlHash(normalized);
    if (normalized !== existing.canonicalUrl) {
      updatedCanonicalUrl = normalized;
      updatedCanonicalHash = newHash;
      changes.canonical_link_updated = { before: 'false', after: 'true' };
    }
  }

  let updatedCategory = existing.category;
  if (snap.category !== undefined) {
    updatedCategory = validateCategory(snap.category);
    if (updatedCategory !== existing.category) {
      changes.category = { before: existing.category, after: updatedCategory };
    }
  }

  let updatedDescription = existing.description;
  if (snap.description !== undefined) {
    updatedDescription = validateDescription(snap.description);
    if (updatedDescription !== existing.description) {
      changes.description_updated = { before: 'false', after: 'true' };
    }
  }

  let updatedAudience = existing.audienceNotes;
  if (snap.audienceNotes !== undefined) {
    updatedAudience = validateAudienceNotes(snap.audienceNotes);
    if (updatedAudience !== existing.audienceNotes) {
      changes.audience_notes_updated = { before: 'false', after: 'true' };
    }
  }

  let updatedAllowed = existing.allowedClaimsNotes;
  if (snap.allowedClaimsNotes !== undefined) {
    updatedAllowed = validateAllowedClaimsNotes(snap.allowedClaimsNotes);
    if (updatedAllowed !== existing.allowedClaimsNotes) {
      changes.allowed_claims_updated = { before: 'false', after: 'true' };
    }
  }

  let updatedProhibited = existing.prohibitedClaimsNotes;
  if (snap.prohibitedClaimsNotes !== undefined) {
    updatedProhibited = validateProhibitedClaimsNotes(snap.prohibitedClaimsNotes);
    if (updatedProhibited !== existing.prohibitedClaimsNotes) {
      changes.prohibited_claims_updated = { before: 'false', after: 'true' };
    }
  }

  let updatedStatus: ProductStatus = existing.status;
  if (snap.status !== undefined) {
    if (!isProductStatus(snap.status)) {
      throw new ValidationError(`Invalid product status: ${snap.status}`, 'status');
    }
    if (snap.status === 'archived') {
      throw new ValidationError(
        'Product status cannot be updated to archived via updateProduct; use archiveProduct',
        'status',
      );
    }
    if (snap.status !== existing.status) {
      if (!canTransitionProductStatus(existing.status, snap.status)) {
        throw new ValidationError(
          `Invalid product status transition from ${existing.status} to ${snap.status}`,
          'status',
        );
      }
      updatedStatus = snap.status;
      changes.status = { before: existing.status, after: updatedStatus };
    }
  }

  const updates: UpdateProductFields = {
    name: updatedName,
    merchantName: updatedMerchant,
    canonicalUrl: updatedCanonicalUrl,
    canonicalUrlHash: updatedCanonicalHash,
    category: updatedCategory,
    description: updatedDescription,
    audienceNotes: updatedAudience,
    allowedClaimsNotes: updatedAllowed,
    prohibitedClaimsNotes: updatedProhibited,
    status: updatedStatus,
    updatedAt: now,
  };

  return { updates, changes };
}
