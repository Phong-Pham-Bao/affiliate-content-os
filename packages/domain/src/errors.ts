export class DomainValidationError extends Error {
  public readonly field?: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'DomainValidationError';
    if (field !== undefined) {
      this.field = field;
    }
  }
}
