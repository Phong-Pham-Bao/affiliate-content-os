import { createHash } from 'node:crypto';
import type { AIProvenanceSnapshot, AIUsageSnapshot } from '@affiliate-content-os/domain';

export const MAX_RAW_RESPONSE_BYTES = 1048576; // 1 MB limit

export interface GeminiResponseLike {
  readonly text?: string | (() => string) | undefined;
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly totalTokenCount?: number;
  };
  readonly candidates?: readonly {
    readonly finishReason?: string;
  }[];
}

export interface GeminiClientLike {
  readonly models: {
    readonly generateContent: (params: unknown) => Promise<GeminiResponseLike>;
  };
}

export function extractResponseText(response: GeminiResponseLike): string {
  if (typeof response.text === 'function') {
    return response.text();
  }
  if (typeof response.text === 'string') {
    return response.text;
  }
  return '';
}

function validateSafeNonNegativeInt(val: unknown, max = 100_000_000): number {
  if (typeof val === 'number' && Number.isSafeInteger(val) && val >= 0 && val <= max) {
    return val;
  }
  return 0;
}

export function buildUsageSnapshot(
  metadata: GeminiResponseLike['usageMetadata'],
  latencyMs: number,
): AIUsageSnapshot {
  return Object.freeze({
    tokenInput: validateSafeNonNegativeInt(metadata?.promptTokenCount),
    tokenOutput: validateSafeNonNegativeInt(metadata?.candidatesTokenCount),
    costMicrounits: 0,
    costCurrency: 'USD',
    latencyMs: validateSafeNonNegativeInt(latencyMs, 3_600_000),
  });
}

export function buildProvenanceSnapshot(model: string, template: string): AIProvenanceSnapshot {
  return Object.freeze({
    provider: 'google',
    model,
    promptTemplate: template,
    promptVersion: '1.0.0',
    inputSchemaVersion: 1,
    outputSchemaVersion: 1,
  });
}

export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalJsonStringify).join(',') + ']';
  }
  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]));
  return '{' + entries.join(',') + '}';
}

export function computeCanonicalJsonHash(value: unknown): Uint8Array {
  return createHash('sha256').update(canonicalJsonStringify(value), 'utf8').digest();
}

export function computeCanonicalHash(rawText: string): Uint8Array {
  return createHash('sha256').update(rawText).digest();
}
