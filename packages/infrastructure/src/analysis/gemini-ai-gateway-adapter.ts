import { GoogleGenAI } from '@google/genai';
import type {
  AIAnalysisGatewayResult,
  AIGatewayPort,
  AINicheAnalysisInput,
  AIPlanningRoleInput,
  AIProductAnalysisInput,
  AIScriptVideoInput,
} from '@affiliate-content-os/application';
import type {
  AudienceInsightBoard,
  NicheAnalysisContent,
  ProductAnalysisContent,
  ProductCampaignPlan,
  SingleVideoScript,
  VideoSeriesPlan,
} from '@affiliate-content-os/domain';
import type { AIConfig } from '@affiliate-content-os/config';
import {
  buildNicheAnalysisPrompt,
  buildProductAnalysisPrompt,
  buildRepairPrompt,
} from './gemini-prompt-builder.js';
import {
  buildAudienceInsightBoardPrompt,
  buildProductCampaignPlanPrompt,
  buildVideoSeriesPlanPrompt,
} from './gemini-planning-prompt-builder.js';
import { buildScriptVideoPrompt } from './gemini-script-prompt-builder.js';
import { productAnalysisJsonSchema, nicheAnalysisJsonSchema } from './gemini-schemas.js';
import {
  audienceInsightBoardJsonSchema,
  productCampaignPlanJsonSchema,
  videoSeriesPlanJsonSchema,
} from './gemini-planning-schemas.js';
import { singleVideoScriptJsonSchema } from './gemini-script-schemas.js';
import { executeGeminiCall } from './gemini-call-executor.js';
import type { GeminiClientLike } from './gemini-adapter-helpers.js';

export interface GeminiAdapterOptions {
  readonly config: AIConfig;
  readonly client?: GeminiClientLike | undefined;
}

export class GeminiAIGatewayAdapter implements AIGatewayPort {
  private readonly client: GeminiClientLike;
  private readonly config: AIConfig;

  constructor(options: GeminiAdapterOptions) {
    this.config = options.config;
    if (options.client) {
      this.client = options.client;
    } else {
      if (!this.config.geminiApiKey) {
        throw new Error('Cannot initialize GeminiAIGatewayAdapter without GEMINI_API_KEY');
      }
      this.client = new GoogleGenAI({
        apiKey: this.config.geminiApiKey,
        httpOptions: { timeout: this.config.geminiTimeoutMs },
      }) as unknown as GeminiClientLike;
    }
  }

  public async executeProductAnalysis(
    input: AIProductAnalysisInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<ProductAnalysisContent>> {
    const basePrompt = buildProductAnalysisPrompt(input);
    const prompt = repairFeedback ? buildRepairPrompt(basePrompt, repairFeedback) : basePrompt;
    return this.call<ProductAnalysisContent>(
      prompt,
      productAnalysisJsonSchema,
      'product_analysis_v1',
      options?.signal,
    );
  }

  public async executeNicheAnalysis(
    input: AINicheAnalysisInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<NicheAnalysisContent>> {
    const basePrompt = buildNicheAnalysisPrompt(input);
    const prompt = repairFeedback ? buildRepairPrompt(basePrompt, repairFeedback) : basePrompt;
    return this.call<NicheAnalysisContent>(
      prompt,
      nicheAnalysisJsonSchema,
      'niche_analysis_v1',
      options?.signal,
    );
  }

  public async executeProductCampaignPlan(
    input: AIPlanningRoleInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<ProductCampaignPlan>> {
    const basePrompt = buildProductCampaignPlanPrompt(input);
    const prompt = repairFeedback ? buildRepairPrompt(basePrompt, repairFeedback) : basePrompt;
    return this.call<ProductCampaignPlan>(
      prompt,
      productCampaignPlanJsonSchema,
      'product_campaign_plan_v1',
      options?.signal,
    );
  }

  public async executeAudienceInsightBoard(
    input: AIPlanningRoleInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<AudienceInsightBoard>> {
    const basePrompt = buildAudienceInsightBoardPrompt(input);
    const prompt = repairFeedback ? buildRepairPrompt(basePrompt, repairFeedback) : basePrompt;
    return this.call<AudienceInsightBoard>(
      prompt,
      audienceInsightBoardJsonSchema,
      'audience_insight_board_v1',
      options?.signal,
    );
  }

  public async executeVideoSeriesPlan(
    input: AIPlanningRoleInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<VideoSeriesPlan>> {
    const basePrompt = buildVideoSeriesPlanPrompt(input);
    const prompt = repairFeedback ? buildRepairPrompt(basePrompt, repairFeedback) : basePrompt;
    return this.call<VideoSeriesPlan>(
      prompt,
      videoSeriesPlanJsonSchema,
      'video_series_plan_v1',
      options?.signal,
    );
  }

  public async executeScriptVideo(
    input: AIScriptVideoInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<SingleVideoScript>> {
    const basePrompt = buildScriptVideoPrompt(input);
    const prompt = repairFeedback ? buildRepairPrompt(basePrompt, repairFeedback) : basePrompt;
    return this.call<SingleVideoScript>(
      prompt,
      singleVideoScriptJsonSchema,
      'script_video_v1',
      options?.signal,
    );
  }

  private call<T>(
    prompt: string,
    schema: unknown,
    template: string,
    signal?: AbortSignal,
  ): Promise<AIAnalysisGatewayResult<T>> {
    return executeGeminiCall<T>({
      client: this.client,
      config: this.config,
      prompt,
      schema,
      template,
      signal,
    });
  }
}
