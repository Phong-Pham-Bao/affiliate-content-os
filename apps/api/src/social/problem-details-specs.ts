import type { ProblemSpec } from '../auth/problem-details-specs.js';
import {
  CallbackResultForbiddenError,
  CallbackResultGoneError,
  CallbackResultNotFoundError,
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
  SocialAccountDisconnectedError,
  SocialAccountMismatchError,
  SocialAccountNotFoundError,
  SocialAccountVersionMismatchError,
  SocialAuthExchangeError,
  SocialAuthNotConfiguredError,
  SocialAuthOutcomeUnknownError,
  SocialAuthRateLimitError,
  SocialCredentialEncryptionError,
  SocialKillSwitchActiveError,
  SocialPlatformUnsupportedError,
} from '@affiliate-content-os/application';

export const SOCIAL_PROBLEM_SPECS: Record<string, ProblemSpec> = {
  SOCIAL_ACCOUNT_NOT_FOUND: {
    status: 404,
    code: 'NOT_FOUND',
    type: 'https://affiliate-content-os.example/problems/not-found',
    title: 'Not Found',
    detail: 'Social account not found in workspace.',
  },
  SOCIAL_ACCOUNT_DISCONNECTED: {
    status: 409,
    code: 'SOCIAL_ACCOUNT_DISCONNECTED',
    type: 'https://affiliate-content-os.example/problems/conflict',
    title: 'Conflict',
    detail: 'The social account has already been disconnected.',
  },
  SOCIAL_ACCOUNT_VERSION_MISMATCH: {
    status: 412,
    code: 'PRECONDITION_FAILED',
    type: 'https://affiliate-content-os.example/problems/precondition-failed',
    title: 'Precondition Failed',
    detail: 'Account version has changed or precondition failed.',
  },
  SOCIAL_ACCOUNT_MISMATCH: {
    status: 409,
    code: 'ACCOUNT_MISMATCH',
    type: 'https://affiliate-content-os.example/problems/account-mismatch',
    title: 'Account Mismatch',
    detail: 'The reconnected social account does not match the bound provider account.',
  },
  SOCIAL_KILL_SWITCH_ACTIVE: {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    type: 'https://affiliate-content-os.example/problems/service-unavailable',
    title: 'Service Unavailable',
    detail: 'This social platform or feature is temporarily disabled by administrative policy.',
  },
  SOCIAL_AUTH_OUTCOME_UNKNOWN: {
    status: 504,
    code: 'GATEWAY_TIMEOUT',
    type: 'https://affiliate-content-os.example/problems/gateway-timeout',
    title: 'Gateway Timeout',
    detail: 'Provider request timed out before outcome could be verified safely.',
  },
  SOCIAL_CALLBACK_RESULT_FORBIDDEN: {
    status: 403,
    code: 'FORBIDDEN',
    type: 'https://affiliate-content-os.example/problems/forbidden',
    title: 'Forbidden',
    detail: 'Not authorized to consume this callback result.',
  },
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

  if (error instanceof SocialAccountNotFoundError || name === 'SocialAccountNotFoundError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_ACCOUNT_NOT_FOUND']!;
  }
  if (
    error instanceof SocialAccountDisconnectedError ||
    name === 'SocialAccountDisconnectedError'
  ) {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_ACCOUNT_DISCONNECTED']!;
  }
  if (
    error instanceof SocialAccountVersionMismatchError ||
    name === 'SocialAccountVersionMismatchError'
  ) {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_ACCOUNT_VERSION_MISMATCH']!;
  }
  if (error instanceof SocialAccountMismatchError || name === 'SocialAccountMismatchError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_ACCOUNT_MISMATCH']!;
  }
  if (error instanceof SocialKillSwitchActiveError || name === 'SocialKillSwitchActiveError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_KILL_SWITCH_ACTIVE']!;
  }
  if (error instanceof SocialAuthOutcomeUnknownError || name === 'SocialAuthOutcomeUnknownError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_AUTH_OUTCOME_UNKNOWN']!;
  }
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
  if (error instanceof CallbackResultForbiddenError || name === 'CallbackResultForbiddenError') {
    return SOCIAL_PROBLEM_SPECS['SOCIAL_CALLBACK_RESULT_FORBIDDEN']!;
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
