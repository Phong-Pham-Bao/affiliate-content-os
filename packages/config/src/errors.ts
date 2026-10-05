export interface ConfigurationIssue {
  readonly field: string;
  readonly message: string;
}

export class ConfigurationError extends Error {
  public readonly issues: readonly ConfigurationIssue[];

  constructor(issues: readonly ConfigurationIssue[]) {
    const summary = issues.map((i) => `${i.field}: ${i.message}`).join('; ');
    super(`Configuration validation failed: ${summary}`);
    this.name = 'ConfigurationError';
    this.issues = Object.freeze([...issues]);
    Object.freeze(this);
  }
}
