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
