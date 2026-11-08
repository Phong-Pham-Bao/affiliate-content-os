import type { AIAnalysisGatewayResult } from '@affiliate-content-os/application';
import type { AIConfig } from '@affiliate-content-os/config';
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

export interface ExecuteGeminiCallOptions {
  readonly client: GeminiClientLike;
  readonly config: AIConfig;
  readonly prompt: string;
  readonly schema: unknown;
  readonly template: string;
  readonly signal?: AbortSignal | undefined;
}

export async function executeGeminiCall<T>(
  opts: ExecuteGeminiCallOptions,
): Promise<AIAnalysisGatewayResult<T>> {
  const { client, config, prompt, schema, template, signal } = opts;
  const provenance = buildProvenanceSnapshot(config.geminiModel, template);
  const startTime = Date.now();

  if (signal?.aborted) {
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
    const response: GeminiResponseLike = await client.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        thinkingConfig: {
          thinkingLevel: config.geminiThinkingLevel.toUpperCase(),
        },
        maxOutputTokens: config.geminiMaxOutputTokens,
        httpOptions: {
          timeout: config.geminiTimeoutMs,
          retryOptions: { attempts: 1 },
        },
        ...(signal ? { abortSignal: signal } : {}),
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
