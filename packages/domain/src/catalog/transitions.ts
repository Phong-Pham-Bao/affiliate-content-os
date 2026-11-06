import type { AffiliateDestinationStatus, FactSetStatus, ProductStatus } from './types.js';

export function canTransitionProductStatus(current: ProductStatus, target: ProductStatus): boolean {
  if (current === target) {
    return target === 'archived'; // Archiving is idempotent
  }
  switch (current) {
    case 'draft':
      return target === 'active' || target === 'archived';
    case 'active':
      return target === 'archived';
    case 'archived':
      return false; // Terminal state
    default:
      return false;
  }
}

export function canTransitionFactSetStatus(current: FactSetStatus, target: FactSetStatus): boolean {
  if (current === target) {
    return target === 'confirmed'; // Confirmation is idempotent for the same state
  }
  if (current === 'proposed' && target === 'confirmed') {
    return true;
  }
  return false; // Confirmed fact sets are immutable
}

export function canTransitionAffiliateStatus(
  current: AffiliateDestinationStatus,
  target: AffiliateDestinationStatus,
): boolean {
  if (current === target) {
    return target === 'archived'; // Archiving is idempotent
  }
  if (current === 'active' && target === 'archived') {
    return true;
  }
  return false;
}
