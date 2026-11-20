export class SocialAuthNotConfiguredError extends Error {
  public override readonly name = 'SocialAuthNotConfiguredError';
  constructor(message = 'Social authentication is disabled or not configured.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialPlatformUnsupportedError extends Error {
  public override readonly name = 'SocialPlatformUnsupportedError';
  constructor(platform: string) {
    super(`Social platform "${platform}" is not supported.`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OAuthTransactionNotFoundError extends Error {
  public override readonly name = 'OAuthTransactionNotFoundError';
  constructor(message = 'OAuth transaction was not found or has been removed.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OAuthTransactionExpiredError extends Error {
  public override readonly name = 'OAuthTransactionExpiredError';
  constructor(message = 'OAuth transaction has expired.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OAuthTransactionReplayedError extends Error {
  public override readonly name = 'OAuthTransactionReplayedError';
  constructor(message = 'OAuth transaction state has already been consumed.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OAuthCallbackInvalidError extends Error {
  public override readonly name = 'OAuthCallbackInvalidError';
  constructor(message = 'OAuth callback query parameters are malformed, ambiguous, or missing.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CallbackResultNotFoundError extends Error {
  public override readonly name = 'CallbackResultNotFoundError';
  constructor(message = 'OAuth callback result was not found.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CallbackResultGoneError extends Error {
  public override readonly name = 'CallbackResultGoneError';
  constructor(message = 'OAuth callback result has expired or has already been consumed.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CallbackResultForbiddenError extends Error {
  public override readonly name = 'CallbackResultForbiddenError';
  constructor(message = 'Not authorized to consume this callback result.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAuthExchangeError extends Error {
  public override readonly name = 'SocialAuthExchangeError';
  constructor(message = 'Failed to exchange authorization code with provider.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAuthTerminalError extends Error {
  public override readonly name = 'SocialAuthTerminalError';
  public readonly reason: 'token_expired' | 'token_revoked' | 'invalid_grant';
  constructor(
    message = 'Provider token is expired, revoked, or invalid (terminal).',
    reason: 'token_expired' | 'token_revoked' | 'invalid_grant' = 'token_expired',
  ) {
    super(message);
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAuthRateLimitError extends Error {
  public override readonly name = 'SocialAuthRateLimitError';
  public readonly retryAfterSeconds?: number | undefined;
  constructor(
    message = 'Rate limit exceeded for social authentication.',
    retryAfterSeconds?: number | undefined,
  ) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialCredentialEncryptionError extends Error {
  public override readonly name = 'SocialCredentialEncryptionError';
  constructor(message = 'Failed to encrypt or decrypt social credentials.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAccountNotFoundError extends Error {
  public override readonly name = 'SocialAccountNotFoundError';
  constructor(message = 'Social account was not found in this workspace.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAccountDisconnectedError extends Error {
  public override readonly name = 'SocialAccountDisconnectedError';
  constructor(message = 'Social account is disconnected.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAccountVersionMismatchError extends Error {
  public override readonly name = 'SocialAccountVersionMismatchError';
  constructor(message = 'Social account version mismatch. State has been updated concurrently.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAccountMismatchError extends Error {
  public override readonly name = 'SocialAccountMismatchError';
  constructor(message = 'Provider account returned does not match the reconnected account.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialKillSwitchActiveError extends Error {
  public override readonly name = 'SocialKillSwitchActiveError';
  constructor(
    message = 'Social connection operations are temporarily disabled by platform kill switch.',
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAuthOutcomeUnknownError extends Error {
  public override readonly name = 'SocialAuthOutcomeUnknownError';
  constructor(message = 'Network timeout occurred and provider issuance outcome is unknown.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialOperationFenceLostError extends Error {
  public override readonly name = 'SocialOperationFenceLostError';
  constructor(message = 'Operation lease or fencing was lost to a concurrent process.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SocialAccountReauthRequiredError extends Error {
  public override readonly name = 'SocialAccountReauthRequiredError';
  constructor(message = 'Social account requires reauthorization. Please reconnect the account.') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function classifyOperationSafeError(err: unknown): {
  readonly errorCode: string;
  readonly errorMessage: string;
} {
  if (err instanceof SocialOperationFenceLostError) {
    return {
      errorCode: 'FENCE_LOST',
      errorMessage: 'Operation lease or fencing was lost to a concurrent process.',
    };
  }
  if (err instanceof SocialAccountReauthRequiredError) {
    return {
      errorCode: 'REAUTH_REQUIRED',
      errorMessage: 'Social account requires reauthorization. Please reconnect the account.',
    };
  }
  if (err instanceof SocialAccountVersionMismatchError) {
    return {
      errorCode: 'VERSION_MISMATCH',
      errorMessage: 'Social account version changed concurrently. Please retry.',
    };
  }
  if (err instanceof SocialAccountNotFoundError) {
    return {
      errorCode: 'NOT_FOUND',
      errorMessage: 'Social account was not found in this workspace.',
    };
  }
  if (err instanceof SocialAuthRateLimitError) {
    return {
      errorCode: 'RATE_LIMITED',
      errorMessage: 'Provider rate limit exceeded. Please retry later.',
    };
  }
  if (err instanceof SocialAuthTerminalError) {
    return {
      errorCode: 'TERMINAL_AUTH_ERROR',
      errorMessage: 'Provider authorization is invalid, revoked, or expired.',
    };
  }
  if (err instanceof SocialAuthOutcomeUnknownError) {
    return {
      errorCode: 'OUTCOME_UNKNOWN',
      errorMessage: 'Provider request timed out before outcome could be established safely.',
    };
  }
  if (err instanceof SocialCredentialEncryptionError) {
    return {
      errorCode: 'CRYPTO_ERROR',
      errorMessage: 'Failed to process encrypted credentials.',
    };
  }
  if (err instanceof SocialPlatformUnsupportedError) {
    return {
      errorCode: 'PLATFORM_UNSUPPORTED',
      errorMessage: 'The requested social platform is not supported.',
    };
  }
  if (err instanceof SocialKillSwitchActiveError) {
    return {
      errorCode: 'KILL_SWITCH_ACTIVE',
      errorMessage: 'Social operations are temporarily disabled by administrative policy.',
    };
  }
  return {
    errorCode: 'INTERNAL_ERROR',
    errorMessage: 'An internal error occurred during the social account operation.',
  };
}

export function reconstructOperationSafeError(errorCode: string | null | undefined): Error {
  switch (errorCode) {
    case 'OUTCOME_UNKNOWN':
      return new SocialAuthOutcomeUnknownError(
        'Provider request timed out before outcome could be established safely. Reauthorization is required.',
      );
    case 'REAUTH_REQUIRED':
      return new SocialAccountReauthRequiredError(
        'Social account requires reauthorization. Please reconnect the account.',
      );
    case 'FENCE_LOST':
      return new SocialOperationFenceLostError(
        'Operation lease or fencing was lost to a concurrent process.',
      );
    case 'VERSION_MISMATCH':
      return new SocialAccountVersionMismatchError(
        'Social account version changed concurrently. Please retry.',
      );
    case 'NOT_FOUND':
      return new SocialAccountNotFoundError('Social account was not found in this workspace.');
    case 'RATE_LIMITED':
      return new SocialAuthRateLimitError('Provider rate limit exceeded. Please retry later.');
    case 'TERMINAL_AUTH_ERROR':
      return new SocialAuthTerminalError('Provider authorization is invalid, revoked, or expired.');
    case 'CRYPTO_ERROR':
      return new SocialCredentialEncryptionError('Failed to process encrypted credentials.');
    case 'PLATFORM_UNSUPPORTED':
      return new SocialPlatformUnsupportedError('The requested social platform is not supported.');
    case 'KILL_SWITCH_ACTIVE':
      return new SocialKillSwitchActiveError(
        'Social operations are temporarily disabled by administrative policy.',
      );
    default:
      return new Error('An internal error occurred during the social account operation.');
  }
}
