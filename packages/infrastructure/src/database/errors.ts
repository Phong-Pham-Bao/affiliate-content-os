export class DatabaseError extends Error {
  public readonly code?: string | undefined;

  constructor(
    message: string,
    options?: { readonly cause?: unknown; readonly code?: string | undefined },
  ) {
    super(message, options ? { cause: options.cause } : undefined);
    this.name = 'DatabaseError';
    if (options?.code !== undefined) {
      this.code = options.code;
    }
  }
}

const REDACT_URL_REGEX = /postgres(ql)?:\/\/[^\s"'<>]+/gi;

export function stripCredentials(text: string): string {
  return text.replace(REDACT_URL_REGEX, (matched) => {
    try {
      const url = new URL(matched);
      const host = url.host;
      const db = url.pathname;
      return `${url.protocol}//[REDACTED]@${host}${db}`;
    } catch {
      return 'postgresql://[REDACTED]';
    }
  });
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

    return new DatabaseError(message, { cause: err, code });
  }

  return new DatabaseError(contextMessage ?? 'Database operation failed');
}
