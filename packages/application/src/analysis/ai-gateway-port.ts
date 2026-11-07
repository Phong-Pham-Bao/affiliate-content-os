import type {
  AIProvenanceSnapshot,
  AIUsageSnapshot,
  AnalysisSnapshot,
  NicheAnalysisContent,
  ProductAnalysisContent,
  ProductFactSnapshot,
  SafeFailureCategory,
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
}
