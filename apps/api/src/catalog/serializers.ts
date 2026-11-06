import type {
  AffiliateDestinationSnapshot,
  ProductFactSetSnapshot,
  ProductFactSnapshot,
  ProductSnapshot,
} from '@affiliate-content-os/domain';

export function serializeProduct(
  product: ProductSnapshot,
  extra?: { duplicateWarning?: boolean; alreadyArchived?: boolean },
): Record<string, unknown> {
  return {
    id: product.id,
    workspaceId: product.workspaceId,
    name: product.name,
    merchantName: product.merchantName,
    canonicalUrl: product.canonicalUrl,
    category: product.category,
    description: product.description,
    audienceNotes: product.audienceNotes,
    allowedClaimsNotes: product.allowedClaimsNotes,
    prohibitedClaimsNotes: product.prohibitedClaimsNotes,
    status: product.status,
    currentFactSetId: product.currentFactSetId,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    version: product.version,
    ...(extra?.duplicateWarning !== undefined ? { duplicateWarning: extra.duplicateWarning } : {}),
    ...(extra?.alreadyArchived !== undefined ? { alreadyArchived: extra.alreadyArchived } : {}),
  };
}

export function serializeFactSet(factSet: ProductFactSetSnapshot): Record<string, unknown> {
  return {
    id: factSet.id,
    workspaceId: factSet.workspaceId,
    productId: factSet.productId,
    revisionNumber: factSet.revisionNumber,
    status: factSet.status,
    summary: factSet.summary,
    confirmedByUserId: factSet.confirmedByUserId,
    confirmedAt: factSet.confirmedAt,
    createdByUserId: factSet.createdByUserId,
    createdAt: factSet.createdAt,
    updatedAt: factSet.updatedAt,
    version: factSet.version,
  };
}

export function serializeFact(fact: ProductFactSnapshot): Record<string, unknown> {
  return {
    id: fact.id,
    workspaceId: fact.workspaceId,
    productId: fact.productId,
    factSetId: fact.factSetId,
    factKey: fact.factKey,
    valueText: fact.valueText,
    sourceType: fact.sourceType,
    sourceUrl: fact.sourceUrl,
    sourceExcerpt: fact.sourceExcerpt,
    confidence: fact.confidence,
    claimUsage: fact.claimUsage,
    createdAt: fact.createdAt,
  };
}

export function serializeAffiliate(
  destination: AffiliateDestinationSnapshot,
  extra?: { alreadyArchived?: boolean },
): Record<string, unknown> {
  return {
    id: destination.id,
    workspaceId: destination.workspaceId,
    productId: destination.productId,
    label: destination.label,
    url: destination.url,
    networkName: destination.networkName,
    status: destination.status,
    createdAt: destination.createdAt,
    updatedAt: destination.updatedAt,
    version: destination.version,
    ...(extra?.alreadyArchived !== undefined ? { alreadyArchived: extra.alreadyArchived } : {}),
  };
}
