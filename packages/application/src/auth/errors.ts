export type AuthRequestValidationField = 'returnTo' | 'state' | 'code' | 'session' | 'origin';

export type AuthPersistenceOperation = 'transaction' | 'session' | 'workspace';

export class AuthConfigurationUnavailableError extends Error {
  public override readonly name = 'AuthConfigurationUnavailableError';
  public readonly code = 'AUTH_NOT_CONFIGURED' as const;

  constructor() {
    super('Authentication is not configured');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthRequestValidationError extends Error {
  public override readonly name = 'AuthRequestValidationError';
  public readonly code = 'AUTH_REQUEST_INVALID' as const;

  constructor(public readonly field: AuthRequestValidationField) {
    super('Invalid authentication request');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OidcCallbackInvalidError extends Error {
  public override readonly name = 'OidcCallbackInvalidError';
  public readonly code = 'OIDC_CALLBACK_INVALID' as const;

  constructor() {
    super('Invalid OIDC callback');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OidcProviderUnavailableError extends Error {
  public override readonly name = 'OidcProviderUnavailableError';
  public readonly code = 'OIDC_PROVIDER_UNAVAILABLE' as const;

  constructor() {
    super('OIDC provider is unavailable');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationRequiredError extends Error {
  public override readonly name = 'AuthenticationRequiredError';
  public readonly code = 'AUTHENTICATION_REQUIRED' as const;

  constructor() {
    super('Authentication required');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthPersistenceError extends Error {
  public override readonly name = 'AuthPersistenceError';
  public readonly code = 'AUTH_PERSISTENCE_INVALID' as const;

  constructor(public readonly operation: AuthPersistenceOperation) {
    super('Authentication persistence failure');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
