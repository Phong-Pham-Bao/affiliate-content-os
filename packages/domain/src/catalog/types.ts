import type { IsoTimestamp } from '../timestamps.js';
import type { UserId, WorkspaceId } from '../ids.js';
import type { AffiliateDestinationId, ProductFactId, ProductFactSetId, ProductId } from './ids.js';

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export function isProductStatus(value: unknown): value is ProductStatus {
  return typeof value === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(value);
}

export const FACT_SET_STATUSES = ['proposed', 'confirmed'] as const;
export type FactSetStatus = (typeof FACT_SET_STATUSES)[number];

export function isFactSetStatus(value: unknown): value is FactSetStatus {
  return typeof value === 'string' && (FACT_SET_STATUSES as readonly string[]).includes(value);
}

export const FACT_SOURCE_TYPES = ['user', 'merchant_page', 'document', 'other'] as const;
export type FactSourceType = (typeof FACT_SOURCE_TYPES)[number];

export function isFactSourceType(value: unknown): value is FactSourceType {
  return typeof value === 'string' && (FACT_SOURCE_TYPES as readonly string[]).includes(value);
}

export const FACT_CONFIDENCES = ['confirmed', 'suggested', 'uncertain'] as const;
export type FactConfidence = (typeof FACT_CONFIDENCES)[number];

export function isFactConfidence(value: unknown): value is FactConfidence {
  return typeof value === 'string' && (FACT_CONFIDENCES as readonly string[]).includes(value);
}

export const FACT_CLAIM_USAGES = ['allowed', 'context_only', 'prohibited'] as const;
export type FactClaimUsage = (typeof FACT_CLAIM_USAGES)[number];

export function isFactClaimUsage(value: unknown): value is FactClaimUsage {
  return typeof value === 'string' && (FACT_CLAIM_USAGES as readonly string[]).includes(value);
}

export const AFFILIATE_DESTINATION_STATUSES = ['active', 'archived'] as const;
export type AffiliateDestinationStatus = (typeof AFFILIATE_DESTINATION_STATUSES)[number];

export function isAffiliateDestinationStatus(value: unknown): value is AffiliateDestinationStatus {
  return (
    typeof value === 'string' &&
    (AFFILIATE_DESTINATION_STATUSES as readonly string[]).includes(value)
  );
}

export interface ProductSnapshot {
  readonly id: ProductId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly merchantName: string;
  readonly canonicalUrl: string;
  readonly canonicalUrlHash: Uint8Array;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes: string | null;
  readonly allowedClaimsNotes: string | null;
  readonly prohibitedClaimsNotes: string | null;
  readonly status: ProductStatus;
  readonly currentFactSetId: ProductFactSetId | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface ProductFactSetSnapshot {
  readonly id: ProductFactSetId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly revisionNumber: number;
  readonly status: FactSetStatus;
  readonly summary: string | null;
  readonly createdByUserId: UserId;
  readonly confirmedByUserId: UserId | null;
  readonly confirmedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface ProductFactSnapshot {
  readonly id: ProductFactId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly factSetId: ProductFactSetId;
  readonly factKey: string;
  readonly valueText: string;
  readonly sourceType: FactSourceType;
  readonly sourceUrl: string | null;
  readonly sourceExcerpt: string | null;
  readonly confidence: FactConfidence;
  readonly claimUsage: FactClaimUsage;
  readonly createdAt: IsoTimestamp;
}

export interface AffiliateDestinationSnapshot {
  readonly id: AffiliateDestinationId;
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly label: string;
  readonly url: string;
  readonly networkName: string | null;
  readonly status: AffiliateDestinationStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}
