import type {
  AIProductAnalysisInput,
  AINicheAnalysisInput,
  CatalogPersistencePort,
  AnalysisPersistencePort,
} from '@affiliate-content-os/application';
import {
  parseAnalysisId,
  type AnalysisSnapshot,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';
import type { ValidatedJobPayload } from './job-payload-validator.js';

export interface AuthoritativeAnalysisInput {
  readonly productInput?: AIProductAnalysisInput | undefined;
  readonly nicheInput?: AINicheAnalysisInput | undefined;
}

export async function reconstructAuthoritativeInput(
  payload: ValidatedJobPayload,
  catalogPort: CatalogPersistencePort,
  analysisPort: AnalysisPersistencePort,
): Promise<AuthoritativeAnalysisInput> {
  // 1. Authoritative product lookup
  const product = await catalogPort.findProductById({
    workspaceId: payload.workspaceId,
    productId: payload.productId,
  });
  if (!product) {
    throw new Error(`Product ${payload.productId} not found in workspace ${payload.workspaceId}`);
  }
  if (product.status === 'archived') {
    throw new Error(`Product ${payload.productId} is archived and cannot be analyzed`);
  }

  // 2. Authoritative fact set lookup
  const factSetWithFacts = await catalogPort.findFactSetById({
    workspaceId: payload.workspaceId,
    productId: payload.productId,
    factSetId: payload.factSetId,
  });
  if (!factSetWithFacts || factSetWithFacts.factSet.status !== 'confirmed') {
    throw new Error(`Fact set ${payload.factSetId} is not confirmed or not found`);
  }
  const facts: readonly ProductFactSnapshot[] = factSetWithFacts.facts;

  // 3. Reconstruct based on analysis type
  if (payload.analysisType === 'product') {
    const productInput: AIProductAnalysisInput = {
      workspaceId: payload.workspaceId,
      productId: payload.productId,
      productName: product.name,
      merchantName: product.merchantName,
      category: product.category,
      description: product.description,
      audienceNotes: product.audienceNotes,
      allowedClaimsNotes: product.allowedClaimsNotes,
      prohibitedClaimsNotes: product.prohibitedClaimsNotes,
      facts,
    };
    return { productInput };
  }

  // Niche analysis: reconstruct accepted source analyses
  const sourceAnalyses: AnalysisSnapshot[] = [];
  for (const srcId of payload.sourceAnalysisIds) {
    const analysis = await analysisPort.getAnalysisById(
      payload.workspaceId,
      parseAnalysisId(srcId),
    );
    if (!analysis || analysis.productId !== payload.productId || analysis.status !== 'accepted') {
      throw new Error(
        `Source analysis ${srcId} is not accepted or not found for product ${payload.productId}`,
      );
    }
    sourceAnalyses.push(analysis);
  }

  const nicheInput: AINicheAnalysisInput = {
    workspaceId: payload.workspaceId,
    productId: payload.productId,
    category: product.category,
    sourceAnalyses: Object.freeze(sourceAnalyses),
    facts,
  };

  return { nicheInput };
}
