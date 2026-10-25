import util from 'node:util';
import {
  getDatabaseError,
  hasProxyInPrototypeChain,
  hasSensitiveUrl,
  registerDatabaseErrorPrototype,
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

const V8_ERROR_STACK_DESCRIPTOR = Object.getOwnPropertyDescriptor(new Error(), 'stack');
const V8_NATIVE_STACK_GETTER = V8_ERROR_STACK_DESCRIPTOR?.get;
const V8_NATIVE_STACK_SETTER = V8_ERROR_STACK_DESCRIPTOR?.set;

const GENUINE_DATABASE_ERRORS = new WeakSet<object>();

export function isDatabaseError(value: unknown): value is DatabaseError {
  return typeof value === 'object' && value !== null && GENUINE_DATABASE_ERRORS.has(value);
}

export class DatabaseError extends Error {
  public readonly code?: string | undefined;

  public static override [Symbol.hasInstance](this: object, value: unknown): boolean {
    if (this === DatabaseError) {
      return isDatabaseError(value);
    }
    return isDatabaseError(value) && Function.prototype[Symbol.hasInstance].call(this, value);
  }

  constructor(
    message: string,
    options?: {
      readonly code?: string | undefined;
      readonly cause?: unknown;
    },
  ) {
    super(stripCredentials(message));
    this.name = 'DatabaseError';
    GENUINE_DATABASE_ERRORS.add(this);
    if (options?.code !== undefined) {
      this.code = options.code;
    }
    if (options?.cause !== undefined) {
      this.cause = sanitizeCallbackError(options.cause);
    }

    if (this.stack) {
      const stripped = stripCredentials(this.stack);
      try {
        Object.defineProperty(this, 'stack', {
          value: stripped,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch {
        this.stack = stripped;
      }
    }
  }

  public toJSON(): {
    name: string;
    message: string;
    code?: string;
    cause?: unknown;
  } {
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

registerDatabaseErrorPrototype(DatabaseError.prototype);

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

function getSafeOwnStringProperty(obj: object, prop: string): string | undefined {
  if (util.types.isProxy(obj)) {
    return undefined;
  }
  try {
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    if (!desc) return undefined;
    if (desc.get !== undefined || desc.set !== undefined) return undefined;
    if (typeof desc.value === 'string') return desc.value;
    return undefined;
  } catch {
    return undefined;
  }
}

function classifyRawError(err: unknown): KnownErrorClassification {
  try {
    if (!err || typeof err !== 'object' || hasProxyInPrototypeChain(err as object)) {
      return { code: 'DATABASE_ERROR', message: 'Database operation failed' };
    }

    const rawCode = getSafeOwnStringProperty(err as object, 'code');
    if (rawCode && KNOWN_CODES[rawCode]) {
      return KNOWN_CODES[rawCode];
    }

    const rawMessage = getSafeOwnStringProperty(err as object, 'message')?.toLowerCase() ?? '';

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

    return { code: 'DATABASE_ERROR', message: 'Database operation failed' };
  } catch {
    return { code: 'DATABASE_ERROR', message: 'Database operation failed' };
  }
}

export function sanitizeDatabaseError(
  err: unknown,
  contextMessage?: string | undefined,
): DatabaseError {
  const safeContext =
    typeof contextMessage === 'string' ? stripCredentials(contextMessage) : undefined;
  const fallbackMessage = safeContext
    ? `${safeContext}: Database operation failed`
    : 'Database operation failed';

  try {
    if (
      err === null ||
      err === undefined ||
      typeof err !== 'object' ||
      hasProxyInPrototypeChain(err as object)
    ) {
      return new DatabaseError(fallbackMessage, { code: 'DATABASE_ERROR' });
    }

    const isDbError = isDatabaseError(err);

    if (isDbError) {
      let msgDesc: PropertyDescriptor | undefined;
      let codeDesc: PropertyDescriptor | undefined;
      let stackDesc: PropertyDescriptor | undefined;
      try {
        msgDesc = Object.getOwnPropertyDescriptor(err, 'message');
        codeDesc = Object.getOwnPropertyDescriptor(err, 'code');
        stackDesc = Object.getOwnPropertyDescriptor(err, 'stack');
      } catch {
        return new DatabaseError(fallbackMessage, { code: 'DATABASE_ERROR' });
      }

      if (
        !msgDesc ||
        msgDesc.get !== undefined ||
        msgDesc.set !== undefined ||
        typeof msgDesc.value !== 'string' ||
        (codeDesc && (codeDesc.get !== undefined || codeDesc.set !== undefined))
      ) {
        return new DatabaseError(fallbackMessage, { code: 'DATABASE_ERROR' });
      }

      const rawMsg = msgDesc.value;
      const rawCode = codeDesc && typeof codeDesc.value === 'string' ? codeDesc.value : undefined;

      const needsSanitizeMsg = hasSensitiveUrl(rawMsg);
      let needsSanitizeStack = false;
      if (stackDesc) {
        if (stackDesc.value && typeof stackDesc.value === 'string') {
          needsSanitizeStack = hasSensitiveUrl(stackDesc.value);
        } else if (
          stackDesc.get === V8_NATIVE_STACK_GETTER &&
          stackDesc.set === V8_NATIVE_STACK_SETTER
        ) {
          const s = (err as Error).stack;
          needsSanitizeStack = typeof s === 'string' && hasSensitiveUrl(s);
        } else if (stackDesc.get !== undefined || stackDesc.set !== undefined) {
          needsSanitizeStack = true;
        }
      }

      if (needsSanitizeMsg || needsSanitizeStack) {
        const safeMsg = stripCredentials(rawMsg);
        return new DatabaseError(
          safeContext && !safeMsg.startsWith(safeContext) ? `${safeContext}: ${safeMsg}` : safeMsg,
          { code: rawCode },
        );
      }

      if (safeContext && !rawMsg.startsWith(safeContext)) {
        return new DatabaseError(`${safeContext}: ${rawMsg}`, {
          code: rawCode,
        });
      }

      return err as DatabaseError;
    }

    const classification = classifyRawError(err);
    const message = safeContext
      ? `${safeContext}: ${classification.message}`
      : classification.message;

    return new DatabaseError(message, { code: classification.code });
  } catch {
    return new DatabaseError(fallbackMessage, { code: 'DATABASE_ERROR' });
  }
}
