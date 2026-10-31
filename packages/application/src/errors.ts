export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export class ValidationError extends ApplicationError {
  public readonly field?: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    if (field !== undefined) {
      this.field = field;
    }
  }
}

export class UserNotFoundError extends ApplicationError {
  public readonly userId: string;

  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
    this.userId = userId;
  }
}

export class InactiveUserError extends ApplicationError {
  public readonly userId: string;
  public readonly status: string;

  constructor(userId: string, status: string) {
    super(`User ${userId} is not active (current status: ${status})`);
    this.name = 'InactiveUserError';
    this.userId = userId;
    this.status = status;
  }
}

export class SlugConflictError extends ApplicationError {
  public readonly slug: string;

  constructor(slug: string) {
    super(`Workspace slug conflict: "${slug}" is already in use`);
    this.name = 'SlugConflictError';
    this.slug = slug;
  }
}

export type IdentityClaimField =
  'claims' | 'identityProvider' | 'identitySubject' | 'email' | 'displayName';

export class IdentityClaimsValidationError extends ApplicationError {
  readonly code = 'IDENTITY_CLAIMS_INVALID';
  readonly field: IdentityClaimField;

  constructor(field: IdentityClaimField, message = 'Invalid identity claims') {
    super(message);
    this.name = 'IdentityClaimsValidationError';
    this.field = field;
  }
}

export class IdentityUnavailableError extends ApplicationError {
  readonly code = 'IDENTITY_UNAVAILABLE';

  constructor(message = 'Identity is unavailable') {
    super(message);
    this.name = 'IdentityUnavailableError';
  }
}

export class IdentityPersistenceError extends ApplicationError {
  readonly code = 'IDENTITY_PERSISTENCE_INVALID';
  readonly operation: 'lookup' | 'insert' | 'recovery';

  constructor(operation: 'lookup' | 'insert' | 'recovery', message = 'Identity persistence error') {
    super(message);
    this.name = 'IdentityPersistenceError';
    this.operation = operation;
  }
}

export class IdentityProvisioningRaceError extends ApplicationError {
  readonly code = 'IDENTITY_PROVISIONING_RACE';
  readonly retryable = true as const;

  constructor(message = 'Concurrent identity provisioning race detected') {
    super(message);
    this.name = 'IdentityProvisioningRaceError';
  }
}
