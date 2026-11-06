export type ProductStatus = 'draft' | 'active' | 'archived';
export type FactSetStatus = 'proposed' | 'confirmed';
export type FactSourceType = 'user' | 'merchant_page' | 'document' | 'other';
export type FactConfidence = 'confirmed' | 'suggested' | 'uncertain';
export type FactClaimUsage = 'allowed' | 'context_only' | 'prohibited';
export type AffiliateStatus = 'active' | 'archived';

export interface ProductDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly merchantName: string;
  readonly canonicalUrl: string;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes: string | null;
  readonly allowedClaimsNotes: string | null;
  readonly prohibitedClaimsNotes: string | null;
  readonly status: ProductStatus;
  readonly currentFactSetId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly duplicateWarning?: boolean;
  readonly alreadyArchived?: boolean;
}

export interface FactDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly productId: string;
  readonly factSetId: string;
  readonly factKey: string;
  readonly valueText: string;
  readonly sourceType: FactSourceType;
  readonly sourceUrl: string | null;
  readonly sourceExcerpt: string | null;
  readonly confidence: FactConfidence;
  readonly claimUsage: FactClaimUsage;
  readonly createdAt: string;
}

export interface FactSetDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly productId: string;
  readonly revisionNumber: number;
  readonly status: FactSetStatus;
  readonly summary: string | null;
  readonly confirmedByUserId: string | null;
  readonly confirmedAt: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AffiliateDestinationDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly productId: string;
  readonly label: string;
  readonly url: string;
  readonly networkName: string | null;
  readonly status: AffiliateStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly alreadyArchived?: boolean;
}

export interface PageInfo {
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface ProductListResponse {
  readonly items: readonly ProductDTO[];
  readonly page: PageInfo;
}

export interface FactSetListResponse {
  readonly items: readonly FactSetDTO[];
  readonly page: PageInfo;
}

export interface FactSetDetailResponse {
  readonly factSet: FactSetDTO;
  readonly facts: readonly FactDTO[];
}

export interface ConfirmFactSetResponse {
  readonly factSet: FactSetDTO;
  readonly product: ProductDTO;
  readonly alreadyConfirmed: boolean;
}

export interface AffiliateListResponse {
  readonly items: readonly AffiliateDestinationDTO[];
  readonly page: PageInfo;
}

export interface CreateProductPayload {
  readonly name: string;
  readonly merchantName: string;
  readonly canonicalUrl: string;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes?: string | null;
  readonly allowedClaimsNotes?: string | null;
  readonly prohibitedClaimsNotes?: string | null;
}

export interface UpdateProductPayload {
  readonly name?: string;
  readonly merchantName?: string;
  readonly canonicalUrl?: string;
  readonly category?: string;
  readonly description?: string;
  readonly audienceNotes?: string | null;
  readonly allowedClaimsNotes?: string | null;
  readonly prohibitedClaimsNotes?: string | null;
  readonly status?: 'draft' | 'active';
}

export interface FactInputPayload {
  readonly factKey: string;
  readonly valueText: string;
  readonly sourceType: FactSourceType;
  readonly sourceUrl?: string | null;
  readonly sourceExcerpt?: string | null;
  readonly confidence: FactConfidence;
  readonly claimUsage: FactClaimUsage;
}

export interface CreateFactSetPayload {
  readonly summary?: string | null;
  readonly facts: readonly FactInputPayload[];
}

export interface CreateAffiliatePayload {
  readonly label: string;
  readonly url: string;
  readonly networkName?: string | null;
}

export interface UpdateAffiliatePayload {
  readonly label?: string;
  readonly url?: string;
  readonly networkName?: string | null;
}
