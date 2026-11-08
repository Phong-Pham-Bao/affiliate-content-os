import type {
  AIProvenanceSnapshot,
  AIUsageSnapshot,
  AnalysisSnapshot,
  AudienceInsightBoard,
  ContentBrief,
  NicheAnalysisContent,
  ProductAnalysisContent,
  ProductCampaignPlan,
  ProductFactSnapshot,
  SafeFailureCategory,
  SingleVideoScript,
  VideoSeriesPlan,
  WorkOrderId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type { ProductId } from '@affiliate-content-os/domain';

export interface AIProductAnalysisInput {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly productName: string;
  readonly merchantName: string;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes?: string | null | undefined;
  readonly allowedClaimsNotes?: string | null | undefined;
  readonly prohibitedClaimsNotes?: string | null | undefined;
  readonly facts: readonly ProductFactSnapshot[];
}

export interface AINicheAnalysisInput {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly category: string;
  readonly sourceAnalyses: readonly AnalysisSnapshot[];
  readonly facts: readonly ProductFactSnapshot[];
}

export interface AIPlanningRoleInput {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly productName: string;
  readonly merchantName: string;
  readonly category: string;
  readonly description: string;
  readonly audienceNotes?: string | null | undefined;
  readonly allowedClaimsNotes?: string | null | undefined;
  readonly prohibitedClaimsNotes?: string | null | undefined;
  readonly directiveText: string;
  readonly facts: readonly ProductFactSnapshot[];
  readonly sourceAnalyses: readonly AnalysisSnapshot[];
  readonly brandVoice?: string | null | undefined;
  readonly disclosureRequirement?: string | null | undefined;
}

export interface AIScriptVideoInput {
  readonly workspaceId: WorkspaceId;
  readonly productId: ProductId;
  readonly workOrderId: WorkOrderId;
  readonly videoNumber: 1 | 2 | 3 | 4 | 5;
  readonly targetVariantCount: number;
  readonly brief: ContentBrief;
  readonly changeInstruction?: string | null | undefined;
}

export interface AIAnalysisGatewayResult<T> {
  readonly success: boolean;
  readonly content?: T | undefined;
  readonly rawOutputHash?: Uint8Array | undefined;
  readonly usage: AIUsageSnapshot;
  readonly provenance: AIProvenanceSnapshot;
  readonly safetyResult?: string | null | undefined;
  readonly errorCategory?: SafeFailureCategory | undefined;
  readonly errorMessage?: string | undefined;
  readonly isTransient?: boolean | undefined;
}

export interface AIGatewayPort {
  executeProductAnalysis(
    input: AIProductAnalysisInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string | undefined },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<ProductAnalysisContent>>;

  executeNicheAnalysis(
    input: AINicheAnalysisInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string | undefined },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<NicheAnalysisContent>>;

  executeProductCampaignPlan(
    input: AIPlanningRoleInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string | undefined },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<ProductCampaignPlan>>;

  executeAudienceInsightBoard(
    input: AIPlanningRoleInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string | undefined },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<AudienceInsightBoard>>;

  executeVideoSeriesPlan(
    input: AIPlanningRoleInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string | undefined },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<VideoSeriesPlan>>;

  executeScriptVideo(
    input: AIScriptVideoInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string | undefined },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<SingleVideoScript>>;
}
