export class DatabaseError extends Error {
  public readonly code?: string | undefined;

  constructor(message: string, options?: { readonly code?: string | undefined }) {
    super(message);
    this.name = 'DatabaseError';
    if (options?.code !== undefined) {
      this.code = options.code;
    }
  }

  public toJSON(): { name: string; message: string; code?: string } {
    return {
      name: this.name,
      message: this.message,
      ...(this.code ? { code: this.code } : {}),
    };
  }
}

const REDACT_URL_REGEX = /postgres(ql)?:\/\/[^\s"'<>]+/gi;

export function stripCredentials(text: string): string {
  return text.replace(REDACT_URL_REGEX, 'postgresql://[REDACTED]');
}

export function sanitizeDatabaseError(
  err: unknown,
  contextMessage?: string | undefined,
): DatabaseError {
  if (err instanceof DatabaseError) {
    return err;
  }

  if (err && typeof err === 'object') {
    const errorRecord = err as Record<string, unknown>;
    const rawMessage =
      typeof errorRecord['message'] === 'string'
        ? errorRecord['message']
        : 'Database operation failed';
    const sanitizedRaw = stripCredentials(rawMessage);
    const message = contextMessage ? `${contextMessage}: ${sanitizedRaw}` : sanitizedRaw;
    const code = typeof errorRecord['code'] === 'string' ? errorRecord['code'] : undefined;

    return new DatabaseError(message, { code });
  }

  return new DatabaseError(contextMessage ?? 'Database operation failed');
}
