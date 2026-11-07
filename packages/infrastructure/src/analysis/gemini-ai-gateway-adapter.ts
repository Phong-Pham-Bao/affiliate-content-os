import { GoogleGenAI } from '@google/genai';
import type {
  AIAnalysisGatewayResult,
  AIGatewayPort,
  AINicheAnalysisInput,
  AIProductAnalysisInput,
} from '@affiliate-content-os/application';
import type { NicheAnalysisContent, ProductAnalysisContent } from '@affiliate-content-os/domain';
import type { AIConfig } from '@affiliate-content-os/config';
import {
  buildNicheAnalysisPrompt,
  buildProductAnalysisPrompt,
  buildRepairPrompt,
} from './gemini-prompt-builder.js';
import { productAnalysisJsonSchema, nicheAnalysisJsonSchema } from './gemini-schemas.js';
import { classifyGeminiError } from './gemini-error-classifier.js';
import {
  buildProvenanceSnapshot,
  buildUsageSnapshot,
  computeCanonicalJsonHash,
  extractResponseText,
  MAX_RAW_RESPONSE_BYTES,
  type GeminiClientLike,
  type GeminiResponseLike,
} from './gemini-adapter-helpers.js';

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
    return this.executeCall<ProductAnalysisContent>(
      prompt,
      productAnalysisJsonSchema,
      'product_analysis_v1',
      options,
    );
  }

  public async executeNicheAnalysis(
    input: AINicheAnalysisInput,
    repairFeedback?: { readonly errorCategory: string; readonly errorPath?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<NicheAnalysisContent>> {
    const basePrompt = buildNicheAnalysisPrompt(input);
    const prompt = repairFeedback ? buildRepairPrompt(basePrompt, repairFeedback) : basePrompt;
    return this.executeCall<NicheAnalysisContent>(
      prompt,
      nicheAnalysisJsonSchema,
      'niche_analysis_v1',
      options,
    );
  }

  private async executeCall<T>(
    prompt: string,
    schema: unknown,
    template: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AIAnalysisGatewayResult<T>> {
    const provenance = buildProvenanceSnapshot(this.config.geminiModel, template);
    const startTime = Date.now();

    if (options?.signal?.aborted) {
      return {
        success: false,
        usage: buildUsageSnapshot(undefined, 0),
        provenance,
        errorCategory: 'provider_timeout',
        errorMessage: 'Operation aborted prior to execution',
        isTransient: false,
      };
    }

    try {
      const response: GeminiResponseLike = await this.client.models.generateContent({
        model: this.config.geminiModel,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          thinkingConfig: {
            thinkingLevel: this.config.geminiThinkingLevel.toUpperCase(),
          },
          maxOutputTokens: this.config.geminiMaxOutputTokens,
          httpOptions: {
            timeout: this.config.geminiTimeoutMs,
          },
          ...(options?.signal ? { abortSignal: options.signal } : {}),
        },
      });

      const latencyMs = Date.now() - startTime;
      const usage = buildUsageSnapshot(response.usageMetadata, latencyMs);
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'SAFETY' || finishReason === 'BLOCKLIST') {
        return {
          success: false,
          usage,
          provenance,
          safetyResult: finishReason,
          errorCategory: 'invalid_output',
          errorMessage: 'Generation blocked by provider safety policy',
          isTransient: false,
        };
      }

      const rawText = extractResponseText(response);
      if (Buffer.byteLength(rawText, 'utf8') > MAX_RAW_RESPONSE_BYTES) {
        return {
          success: false,
          usage,
          provenance,
          errorCategory: 'invalid_output',
          errorMessage: 'Response exceeded maximum allowed body size',
          isTransient: false,
        };
      }

      let parsed: T;
      try {
        parsed = JSON.parse(rawText) as T;
      } catch {
        return {
          success: false,
          rawOutputHash: undefined,
          usage,
          provenance,
          errorCategory: 'invalid_output',
          errorMessage: 'Failed to parse JSON response from AI provider',
          isTransient: false,
        };
      }

      const rawOutputHash = computeCanonicalJsonHash(parsed);

      return {
        success: true,
        content: parsed,
        rawOutputHash,
        usage,
        provenance,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const usage = buildUsageSnapshot(undefined, latencyMs);
      const classified = classifyGeminiError(err);
      return {
        success: false,
        usage,
        provenance,
        errorCategory: classified.category,
        errorMessage: classified.message,
        isTransient: classified.isTransient,
      };
    }
  }
}
