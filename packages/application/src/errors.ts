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
