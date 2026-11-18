import type { ProblemSpec } from '../auth/problem-details-specs.js';
import {
  CallbackResultGoneError,
  CallbackResultNotFoundError,
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
  SocialAuthExchangeError,
  SocialAuthNotConfiguredError,
  SocialAuthRateLimitError,
  SocialCredentialEncryptionError,
  SocialPlatformUnsupportedError,
} from '@affiliate-content-os/application';

export const SOCIAL_PROBLEM_SPECS: Record<string, ProblemSpec> = {
  SOCIAL_AUTH_NOT_CONFIGURED: {
    status: 503,
    code: 'SOCIAL_AUTH_NOT_CONFIGURED',
    type: 'https://affiliate-content-os.example/problems/social-auth-not-configured',
    title: 'Service Unavailable',
    detail: 'Social authentication service is not configured or disabled.',
  },
  SOCIAL_PLATFORM_NOT_SUPPORTED: {
    status: 400,
    code: 'SOCIAL_PLATFORM_NOT_SUPPORTED',
    type: 'https://affiliate-content-os.example/problems/social-platform-not-supported',
    title: 'Bad Request',
    detail: 'The requested social platform is not supported.',
  },
  OAUTH_TRANSACTION_NOT_FOUND: {
    status: 404,
    code: 'OAUTH_TRANSACTION_NOT_FOUND',
    type: 'https://affiliate-content-os.example/problems/oauth-transaction-not-found',
    title: 'Not Found',
    detail: 'The OAuth authorization transaction was not found.',
  },
  OAUTH_TRANSACTION_EXPIRED: {
    status: 410,
    code: 'OAUTH_TRANSACTION_EXPIRED',
    type: 'https://affiliate-content-os.example/problems/oauth-transaction-expired',
    title: 'Gone',
    detail: 'The OAuth authorization transaction has expired. Please initiate a new connection.',
  },
  OAUTH_TRANSACTION_REPLAYED: {
    status: 409,
    code: 'OAUTH_TRANSACTION_REPLAYED',
    type: 'https://affiliate-content-os.example/problems/oauth-transaction-replayed',
    title: 'Conflict',
    detail: 'The OAuth authorization transaction state has already been consumed.',
  },
  OAUTH_CALLBACK_INVALID: {
    status: 400,
    code: 'OAUTH_CALLBACK_INVALID',
    type: 'https://affiliate-content-os.example/problems/oauth-callback-invalid',
    title: 'Bad Request',
    detail: 'The OAuth callback parameters are invalid, ambiguous, or missing.',
  },
  SOCIAL_AUTH_EXCHANGE_FAILED: {
    status: 502,
    code: 'SOCIAL_AUTH_EXCHANGE_FAILED',
    type: 'https://affiliate-content-os.example/problems/social-auth-exchange-failed',
    title: 'Bad Gateway',
    detail: 'The social provider rejected the authorization code exchange.',
  },
  SOCIAL_CALLBACK_RESULT_NOT_FOUND: {
    status: 404,
    code: 'SOCIAL_CALLBACK_RESULT_NOT_FOUND',
    type: 'https://affiliate-content-os.example/problems/social-callback-result-not-found',
    title: 'Not Found',
    detail: 'The social connection callback result was not found.',
  },
  SOCIAL_CALLBACK_RESULT_GONE: {
    status: 410,
    code: 'SOCIAL_CALLBACK_RESULT_GONE',
    type: 'https://affiliate-content-os.example/problems/social-callback-result-gone',
    title: 'Gone',
    detail: 'The social connection callback result has expired or has already been consumed.',
  },
  SOCIAL_CREDENTIAL_ENCRYPTION_FAILED: {
    status: 500,
    code: 'INTERNAL_ERROR',
    type: 'https://affiliate-content-os.example/problems/internal-error',
    title: 'Internal Server Error',
    detail: 'An error occurred while securing social credentials.',
  },
};

export function resolveSocialProblemSpec(error: unknown): ProblemSpec | null {
  if (typeof error !== 'object' || error === null) return null;
  const name = (error as { name?: string }).name;

  if (error instanceof SocialAuthNotConfiguredError || name === 'SocialAuthNotConfiguredError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_AUTH_NOT_CONFIGURED']!;
  }
  if (
    error instanceof SocialPlatformUnsupportedError ||
    name === 'SocialPlatformUnsupportedError'
  ) {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_PLATFORM_NOT_SUPPORTED']!;
  }
  if (error instanceof OAuthTransactionNotFoundError || name === 'OAuthTransactionNotFoundError') {
    return SOCIAL_PROBLEM_SPECS['OAUTH_TRANSACTION_NOT_FOUND']!;
  }
  if (error instanceof OAuthTransactionExpiredError || name === 'OAuthTransactionExpiredError') {
    return SOCIAL_PROBLEM_SPECS['OAUTH_TRANSACTION_EXPIRED']!;
  }
  if (error instanceof OAuthTransactionReplayedError || name === 'OAuthTransactionReplayedError') {
    return SOCIAL_PROBLEM_SPECS['OAUTH_TRANSACTION_REPLAYED']!;
  }
  if (error instanceof OAuthCallbackInvalidError || name === 'OAuthCallbackInvalidError') {
    return SOCIAL_PROBLEM_SPECS['OAUTH_CALLBACK_INVALID']!;
  }
  if (error instanceof SocialAuthExchangeError || name === 'SocialAuthExchangeError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_AUTH_EXCHANGE_FAILED']!;
  }
  if (error instanceof CallbackResultNotFoundError || name === 'CallbackResultNotFoundError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_CALLBACK_RESULT_NOT_FOUND']!;
  }
  if (error instanceof CallbackResultGoneError || name === 'CallbackResultGoneError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_CALLBACK_RESULT_GONE']!;
  }
  if (
    error instanceof SocialCredentialEncryptionError ||
    name === 'SocialCredentialEncryptionError'
  ) {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_CREDENTIAL_ENCRYPTION_FAILED']!;
  }
  if (error instanceof SocialAuthRateLimitError || name === 'SocialAuthRateLimitError') {
    return {
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      type: 'https://affiliate-content-os.example/problems/rate-limit-exceeded',
      title: 'Too Many Requests',
      detail: (error as Error).message,
    };
  }
  return null;
}
