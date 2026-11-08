import {
  validateAudienceInsightBoard,
  validateProductCampaignPlan,
  validateVideoSeriesPlan,
} from '@affiliate-content-os/domain';

export interface ValidatedArtifactOutput {
  readonly validatedContent: Record<string, unknown>;
  readonly evidenceRefs: readonly { sourceKind: 'product_fact' | 'analysis'; sourceId: string }[];
}

export function validateWorkforceArtifactOutput(
  taskKey: 'product_strategy' | 'audience_strategy' | 'creative_direction',
  rawContent: unknown,
  validFactIds: ReadonlySet<string>,
  validAnalysisIds: ReadonlySet<string>,
): ValidatedArtifactOutput {
  let validatedContent: Record<string, unknown>;
  let evidenceRefs: readonly { sourceKind: 'product_fact' | 'analysis'; sourceId: string }[];

  if (taskKey === 'product_strategy') {
    const plan = validateProductCampaignPlan(rawContent);
    validatedContent = plan as unknown as Record<string, unknown>;
    evidenceRefs = plan.evidenceReferences;
  } else if (taskKey === 'audience_strategy') {
    const board = validateAudienceInsightBoard(rawContent);
    validatedContent = board as unknown as Record<string, unknown>;
    evidenceRefs = board.evidenceReferences;
  } else {
    const series = validateVideoSeriesPlan(rawContent);
    validatedContent = series as unknown as Record<string, unknown>;
    evidenceRefs = series.evidenceReferences;
  }

  for (const ref of evidenceRefs) {
    const lowerId = ref.sourceId.toLowerCase();
    if (ref.sourceKind === 'product_fact' && !validFactIds.has(lowerId)) {
      throw new Error(`Evidence reference fact ID not found in confirmed facts: ${ref.sourceId}`);
    }
    if (ref.sourceKind === 'analysis' && !validAnalysisIds.has(lowerId)) {
      throw new Error(
        `Evidence reference analysis ID not found in accepted analyses: ${ref.sourceId}`,
      );
    }
  }

  return { validatedContent, evidenceRefs };
}
