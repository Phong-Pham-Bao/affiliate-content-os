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

  constructor(field: IdentityClaimField) {
    super('Invalid identity claims');
    this.name = 'IdentityClaimsValidationError';
    this.field = field;
  }
}

export class IdentityUnavailableError extends ApplicationError {
  readonly code = 'IDENTITY_UNAVAILABLE';

  constructor() {
    super('Identity is unavailable');
    this.name = 'IdentityUnavailableError';
  }
}

export class IdentityPersistenceError extends ApplicationError {
  readonly code = 'IDENTITY_PERSISTENCE_INVALID';
  readonly operation: 'lookup' | 'insert' | 'recovery';

  constructor(operation: 'lookup' | 'insert' | 'recovery') {
    super('Identity persistence error');
    this.name = 'IdentityPersistenceError';
    this.operation = operation;
  }
}

export class IdentityProvisioningRaceError extends ApplicationError {
  readonly code = 'IDENTITY_PROVISIONING_RACE';
  readonly retryable = true as const;

  constructor() {
    super('Concurrent identity provisioning race detected');
    this.name = 'IdentityProvisioningRaceError';
  }
}

export class WorkspaceAuthorizationInputError extends ApplicationError {
  public override readonly name = 'WorkspaceAuthorizationInputError';
  public readonly code = 'WORKSPACE_AUTHORIZATION_INPUT_INVALID' as const;

  constructor() {
    super('Invalid workspace authorization input');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkspaceAccessDeniedError extends ApplicationError {
  public override readonly name = 'WorkspaceAccessDeniedError';
  public readonly code = 'WORKSPACE_ACCESS_DENIED' as const;

  constructor() {
    super('Workspace access denied');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkspaceAuthorizationPersistenceError extends ApplicationError {
  public override readonly name = 'WorkspaceAuthorizationPersistenceError';
  public readonly code = 'WORKSPACE_AUTHORIZATION_PERSISTENCE_INVALID' as const;
  public readonly operation = 'membership_lookup' as const;

  constructor() {
    super('Workspace authorization persistence error');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuditEventInputError extends ApplicationError {
  public override readonly name = 'AuditEventInputError';
  public readonly code = 'AUDIT_EVENT_INPUT_INVALID' as const;
  constructor() {
    super('Invalid audit event input');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuditEventDependencyError extends ApplicationError {
  public override readonly name = 'AuditEventDependencyError';
  public readonly code = 'AUDIT_EVENT_DEPENDENCY_INVALID' as const;
  constructor() {
    super('Audit event dependency error');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class IdempotencyKeyReusedError extends ApplicationError {
  public override readonly name = 'IdempotencyKeyReusedError';
  public readonly code = 'IDEMPOTENCY_KEY_REUSED' as const;

  constructor() {
    super('Idempotency key has already been used with a different request payload');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class IdempotencyConflictError extends ApplicationError {
  public override readonly name = 'IdempotencyConflictError';
  public readonly code = 'IDEMPOTENCY_CONFLICT' as const;

  constructor() {
    super('A concurrent request with the same idempotency key is in progress');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
