import {
  SocialAuthExchangeError,
  SocialAuthOutcomeUnknownError,
  SocialAuthRateLimitError,
  SocialAuthTerminalError,
} from '@affiliate-content-os/application';

export interface ProviderErrorPayload {
  readonly error?: {
    readonly message?: string;
    readonly type?: string;
    readonly code?: number;
    readonly error_subcode?: number;
    readonly is_transient?: boolean;
    readonly error_user_title?: string;
    readonly error_user_msg?: string;
  };
}

export function classifyThreadsError(
  status: number,
  body: string,
  isPreToken: boolean,
  headers?: Readonly<Record<string, string>> | undefined,
): Error {
  let parsed: ProviderErrorPayload | undefined;
  try {
    parsed = JSON.parse(body) as ProviderErrorPayload;
  } catch {
    // Malformed JSON
  }

  const errObj = parsed?.error;
  const code = errObj?.code;
  const subcode = errObj?.error_subcode;

  // Rate limiting (status 429, or Meta codes 4, 17, 32, 613)
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    let retryAfter = 300;
    const retryHeader = headers?.['retry-after'];
    if (retryHeader) {
      const parsedHeader = Number(retryHeader);
      if (Number.isFinite(parsedHeader) && parsedHeader > 0) {
        retryAfter = Math.min(Math.max(parsedHeader, 1), 86400);
      }
    }
    return new SocialAuthRateLimitError('Rate limit exceeded for Threads API', retryAfter);
  }

  // Token expired / revoked (subcode 463: expired, 467: invalid, 458: app deauthorized, 190: auth exception)
  if (subcode === 463) {
    return new SocialAuthTerminalError('Provider token is expired (subcode 463)', 'token_expired');
  }
  if (subcode === 467 || subcode === 458 || code === 190) {
    return new SocialAuthTerminalError(
      'Provider token or grant is revoked or invalid',
      'token_revoked',
    );
  }

  // Pre-token stage network or timeout errors
  if (isPreToken && (status >= 500 || status === 408)) {
    return new SocialAuthOutcomeUnknownError();
  }

  return new SocialAuthExchangeError('Failed to exchange credentials with Threads provider');
}
