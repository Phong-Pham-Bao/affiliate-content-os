import type { SafeFailureCategory } from '@affiliate-content-os/domain';

export interface ClassifiedAIError {
  readonly category: SafeFailureCategory;
  readonly message: string;
  readonly isTransient: boolean;
}

export function classifyGeminiError(err: unknown): ClassifiedAIError {
  if (!err) {
    return {
      category: 'internal_error',
      message: 'Unknown AI provider error occurred',
      isTransient: false,
    };
  }

  // Handle AbortError / Timeout
  if (err instanceof Error) {
    if (
      err.name === 'AbortError' ||
      err.message.toLowerCase().includes('timeout') ||
      err.message.toLowerCase().includes('deadline')
    ) {
      return {
        category: 'provider_timeout',
        message: 'The AI provider request timed out',
        isTransient: true,
      };
    }
  }

  // Check HTTP-like status or API error properties
  const status =
    typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : undefined;

  const rawMsg = err instanceof Error ? err.message : String(err);
  const lowerMsg = rawMsg.toLowerCase();

  // Rate limiting (429 or RESOURCE_EXHAUSTED)
  if (
    status === 429 ||
    lowerMsg.includes('resource_exhausted') ||
    lowerMsg.includes('quota') ||
    lowerMsg.includes('rate limit')
  ) {
    return {
      category: 'rate_limited',
      message: 'AI provider rate limit exceeded; retry shortly',
      isTransient: true,
    };
  }

  // Transient provider unavailability (500, 502, 503, 504, ECONNRESET, ETIMEDOUT)
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lowerMsg.includes('unavailable') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('fetch failed')
  ) {
    return {
      category: 'provider_unavailable',
      message: 'The AI provider service is temporarily unavailable',
      isTransient: true,
    };
  }

  // Safety / Block policy
  if (lowerMsg.includes('safety') || lowerMsg.includes('blocked') || lowerMsg.includes('harm')) {
    return {
      category: 'invalid_output',
      message: 'The AI request was blocked by safety policies',
      isTransient: false,
    };
  }

  // Invalid output or schema mismatch
  if (lowerMsg.includes('json') || lowerMsg.includes('schema') || lowerMsg.includes('parse')) {
    return {
      category: 'invalid_output',
      message: 'The AI provider returned output that failed schema validation',
      isTransient: false,
    };
  }

  // Permanent client errors (400, 401, 403, 404)
  if (status && status >= 400 && status < 500) {
    return {
      category: 'internal_error',
      message: 'AI provider request failed client validation',
      isTransient: false,
    };
  }

  return {
    category: 'internal_error',
    message: 'An internal error occurred during AI analysis',
    isTransient: false,
  };
}
