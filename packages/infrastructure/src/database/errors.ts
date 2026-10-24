import {
  getDatabaseError,
  hasSensitiveUrl,
  sanitizeCallbackError,
  sanitizeRejection,
  setDatabaseErrorFactory,
  stripCredentials,
} from './sanitization.js';

export {
  getDatabaseError,
  hasSensitiveUrl,
  sanitizeCallbackError,
  sanitizeRejection,
  stripCredentials,
};

export class DatabaseError extends Error {
  public readonly code?: string | undefined;

  constructor(
    message: string,
    options?: { readonly code?: string | undefined; readonly cause?: unknown },
  ) {
    super(stripCredentials(message));
    this.name = 'DatabaseError';
    if (options?.code !== undefined) {
      this.code = options.code;
    }
    if (options?.cause !== undefined) {
      this.cause = sanitizeCallbackError(options.cause);
    }

    if (this.stack) {
      this.stack = stripCredentials(this.stack);
    }
  }

  public toJSON(): { name: string; message: string; code?: string; cause?: unknown } {
    return {
      name: this.name,
      message: this.message,
      ...(this.code ? { code: this.code } : {}),
      ...(this.cause !== undefined ? { cause: this.cause } : {}),
    };
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): {
    name: string;
    message: string;
    code?: string;
    cause?: unknown;
  } {
    return this.toJSON();
  }
}

setDatabaseErrorFactory(
  (message: string) => new DatabaseError(message, { code: 'DATABASE_ERROR' }),
);

interface KnownErrorClassification {
  readonly code: string;
  readonly message: string;
}

const KNOWN_CODES: Readonly<Record<string, KnownErrorClassification>> = {
  // PostgreSQL error codes
  '28P01': { code: 'AUTH_FAILED', message: 'Authentication failed' },
  '28000': { code: 'AUTH_FAILED', message: 'Authentication failed' },
  '3D000': { code: 'DATABASE_NOT_FOUND', message: 'Database does not exist' },
  '42P01': { code: 'RELATION_NOT_FOUND', message: 'Relation does not exist' },
  '23505': { code: 'UNIQUE_VIOLATION', message: 'Unique constraint violation' },
  '55P03': {
    code: 'LOCK_NOT_AVAILABLE',
    message: 'Lock acquisition timed out or lock unavailable',
  },
  '57014': { code: 'QUERY_CANCELED', message: 'Query canceled or statement timeout exceeded' },
  '57P01': { code: 'SERVER_SHUTDOWN', message: 'Database server is shutting down' },
  '57P02': { code: 'SERVER_SHUTDOWN', message: 'Database server is shutting down' },
  '57P03': { code: 'SERVER_SHUTDOWN', message: 'Database server is shutting down' },

  // Node.js network / TLS codes
  ECONNREFUSED: { code: 'CONNECTION_REFUSED', message: 'Connection refused' },
  ENOTFOUND: { code: 'HOST_NOT_FOUND', message: 'Database host not found' },
  ETIMEDOUT: { code: 'CONNECTION_TIMED_OUT', message: 'Connection timed out' },
  ECONNRESET: { code: 'CONNECTION_RESET', message: 'Connection reset by peer' },
  EAI_AGAIN: { code: 'DNS_LOOKUP_FAILED', message: 'DNS resolution failed' },
  DEPTH_ZERO_SELF_SIGNED_CERT: {
    code: 'TLS_VERIFICATION_FAILED',
    message: 'TLS certificate verification failed',
  },
  SELF_SIGNED_CERT_IN_CHAIN: {
    code: 'TLS_VERIFICATION_FAILED',
    message: 'TLS certificate verification failed',
  },
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: {
    code: 'TLS_VERIFICATION_FAILED',
    message: 'TLS certificate verification failed',
  },
  CERT_HAS_EXPIRED: {
    code: 'TLS_VERIFICATION_FAILED',
    message: 'TLS certificate verification failed',
  },
};

function classifyRawError(err: unknown): KnownErrorClassification {
  if (err && typeof err === 'object') {
    const errorRecord = err as Record<string, unknown>;
    const rawCode = typeof errorRecord['code'] === 'string' ? errorRecord['code'] : undefined;
    if (rawCode && KNOWN_CODES[rawCode]) {
      return KNOWN_CODES[rawCode];
    }

    const rawMessage =
      typeof errorRecord['message'] === 'string' ? errorRecord['message'].toLowerCase() : '';

    if (
      rawMessage.includes('password authentication failed') ||
      (rawMessage.includes('role') && rawMessage.includes('does not exist'))
    ) {
      return { code: 'AUTH_FAILED', message: 'Authentication failed' };
    }
    if (rawMessage.includes('database') && rawMessage.includes('does not exist')) {
      return { code: 'DATABASE_NOT_FOUND', message: 'Database does not exist' };
    }
    if (rawMessage.includes('connection refused')) {
      return { code: 'CONNECTION_REFUSED', message: 'Connection refused' };
    }
    if (rawMessage.includes('connection reset')) {
      return { code: 'CONNECTION_RESET', message: 'Connection reset by peer' };
    }
    if (
      rawMessage.includes('statement timeout') ||
      rawMessage.includes('canceling statement') ||
      rawMessage.includes('query canceled')
    ) {
      return { code: 'QUERY_CANCELED', message: 'Query canceled or statement timeout exceeded' };
    }
    if (rawMessage.includes('could not obtain lock') || rawMessage.includes('lock not available')) {
      return {
        code: 'LOCK_NOT_AVAILABLE',
        message: 'Lock acquisition timed out or lock unavailable',
      };
    }
    if (rawMessage.includes('shutting down')) {
      return { code: 'SERVER_SHUTDOWN', message: 'Database server is shutting down' };
    }
    if (
      rawMessage.includes('certificate') ||
      rawMessage.includes('tls') ||
      rawMessage.includes('ssl')
    ) {
      return { code: 'TLS_VERIFICATION_FAILED', message: 'TLS certificate verification failed' };
    }
  }

  return { code: 'DATABASE_ERROR', message: 'Database operation failed' };
}

export function sanitizeDatabaseError(
  err: unknown,
  contextMessage?: string | undefined,
): DatabaseError {
  if (err instanceof DatabaseError) {
    if (hasSensitiveUrl(err.message) || (err.stack && hasSensitiveUrl(err.stack))) {
      const safeMsg = stripCredentials(err.message);
      return new DatabaseError(
        contextMessage && !safeMsg.startsWith(contextMessage)
          ? `${contextMessage}: ${safeMsg}`
          : safeMsg,
        { code: err.code },
      );
    }
    if (contextMessage && !err.message.startsWith(contextMessage)) {
      return new DatabaseError(`${contextMessage}: ${err.message}`, { code: err.code });
    }
    return err;
  }

  const classification = classifyRawError(err);
  const message = contextMessage
    ? `${contextMessage}: ${classification.message}`
    : classification.message;

  return new DatabaseError(message, { code: classification.code });
}
