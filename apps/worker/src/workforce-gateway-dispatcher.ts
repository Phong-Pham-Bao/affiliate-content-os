import type {
  AIAnalysisGatewayResult,
  AIGatewayPort,
  AIPlanningRoleInput,
} from '@affiliate-content-os/application';
import type {
  AudienceInsightBoard,
  ProductCampaignPlan,
  VideoSeriesPlan,
} from '@affiliate-content-os/domain';

export type WorkforcePlanningOutput = ProductCampaignPlan | AudienceInsightBoard | VideoSeriesPlan;

export async function dispatchWorkforcePlanningGateway(
  gatewayPort: AIGatewayPort,
  taskKey: 'product_strategy' | 'audience_strategy' | 'creative_direction',
  planningInput: AIPlanningRoleInput,
  repairFeedback?: { errorCategory: string } | undefined,
): Promise<AIAnalysisGatewayResult<WorkforcePlanningOutput>> {
  try {
    if (taskKey === 'product_strategy') {
      return await gatewayPort.executeProductCampaignPlan(planningInput, repairFeedback);
    }
    if (taskKey === 'audience_strategy') {
      return await gatewayPort.executeAudienceInsightBoard(planningInput, repairFeedback);
    }
    return await gatewayPort.executeVideoSeriesPlan(planningInput, repairFeedback);
  } catch (err) {
    return {
      success: false,
      errorCategory: 'provider_unavailable',
      errorMessage: err instanceof Error ? err.message : 'Gateway call threw exception',
      isTransient: true,
      usage: {
        tokenInput: 0,
        tokenOutput: 0,
        costMicrounits: 0,
        costCurrency: 'USD',
        latencyMs: 0,
      },
      provenance: {
        provider: 'google',
        model: 'gemini-3.8-flash',
        promptTemplate: `${taskKey}_v1`,
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
      },
    };
  }
}
