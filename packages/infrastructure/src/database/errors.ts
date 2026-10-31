import util from 'node:util';
import {
  getDatabaseError,
  hasProxyInPrototypeChain,
  hasSensitiveUrl,
  registerDatabaseErrorPrototype,
  sanitizeCallbackError as baseSanitizeCallbackError,
  sanitizeRejection,
  setDatabaseErrorFactory,
  stripCredentials,
} from './sanitization.js';

export { getDatabaseError, hasSensitiveUrl, sanitizeRejection, stripCredentials };

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
    },
  ) {
    super(stripCredentials(message));
    this.name = 'DatabaseError';
    GENUINE_DATABASE_ERRORS.add(this);
    if (options?.code !== undefined) {
      this.code = options.code;
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
  } {
    return {
      name: this.name,
      message: this.message,
      ...(this.code ? { code: this.code } : {}),
    };
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): {
    name: string;
    message: string;
    code?: string;
  } {
    return this.toJSON();
  }
}

setDatabaseErrorFactory(
  (message: string) => new DatabaseError(message, { code: 'DATABASE_ERROR' }),
);

registerDatabaseErrorPrototype(DatabaseError.prototype);

export function sanitizeCallbackError<E = unknown>(err: E): E | Error {
  if (isDatabaseError(err)) {
    return sanitizeDatabaseError(err);
  }
  return baseSanitizeCallbackError(err);
}

const APPROVED_CODES = new Set<string>([
  'DATABASE_ERROR',
  'AUTH_FAILED',
  'DATABASE_NOT_FOUND',
  'RELATION_NOT_FOUND',
  'UNIQUE_VIOLATION',
  'LOCK_NOT_AVAILABLE',
  'QUERY_CANCELED',
  'SERVER_SHUTDOWN',
  'CONNECTION_REFUSED',
  'HOST_NOT_FOUND',
  'CONNECTION_TIMED_OUT',
  'CONNECTION_RESET',
  'DNS_LOOKUP_FAILED',
  'TLS_VERIFICATION_FAILED',
  'FOREIGN_KEY_VIOLATION',
  'CHECK_VIOLATION',
]);

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
      let isStandardProtoChain = false;
      try {
        const p1 = Object.getPrototypeOf(err);
        if (p1 === DatabaseError.prototype) {
          const p2 = Object.getPrototypeOf(p1);
          if (p2 === Error.prototype) {
            const p3 = Object.getPrototypeOf(p2);
            if (p3 === Object.prototype) {
              const p4 = Object.getPrototypeOf(p3);
              if (p4 === null) {
                isStandardProtoChain = true;
              }
            }
          }
        }
      } catch {
        isStandardProtoChain = false;
      }

      let protoClean = true;
      try {
        const protoKeys = Reflect.ownKeys(DatabaseError.prototype);
        for (const k of protoKeys) {
          if (
            k !== 'constructor' &&
            k !== 'toJSON' &&
            k !== Symbol.for('nodejs.util.inspect.custom')
          ) {
            protoClean = false;
            break;
          }
          const desc = Object.getOwnPropertyDescriptor(DatabaseError.prototype, k);
          if (!desc || desc.get !== undefined || desc.set !== undefined) {
            protoClean = false;
            break;
          }
        }
      } catch {
        protoClean = false;
      }

      let hasCause = false;
      try {
        const causeDesc = Object.getOwnPropertyDescriptor(err, 'cause');
        if (causeDesc !== undefined || 'cause' in (err as object)) {
          hasCause = true;
        }
      } catch {
        hasCause = true;
      }

      let hasUnexpectedOwnKeys = false;
      try {
        const ownKeys = Reflect.ownKeys(err);
        for (const k of ownKeys) {
          if (k !== 'name' && k !== 'message' && k !== 'code' && k !== 'stack') {
            hasUnexpectedOwnKeys = true;
            break;
          }
        }
      } catch {
        hasUnexpectedOwnKeys = true;
      }

      let nameDesc: PropertyDescriptor | undefined;
      let msgDesc: PropertyDescriptor | undefined;
      let codeDesc: PropertyDescriptor | undefined;
      let stackDesc: PropertyDescriptor | undefined;
      try {
        nameDesc = Object.getOwnPropertyDescriptor(err, 'name');
        msgDesc = Object.getOwnPropertyDescriptor(err, 'message');
        codeDesc = Object.getOwnPropertyDescriptor(err, 'code');
        stackDesc = Object.getOwnPropertyDescriptor(err, 'stack');
      } catch {
        return new DatabaseError(fallbackMessage, { code: 'DATABASE_ERROR' });
      }

      const isNameTainted =
        !nameDesc ||
        nameDesc.get !== undefined ||
        nameDesc.set !== undefined ||
        nameDesc.value !== 'DatabaseError';

      const isMsgTainted =
        !msgDesc ||
        msgDesc.get !== undefined ||
        msgDesc.set !== undefined ||
        typeof msgDesc.value !== 'string' ||
        hasSensitiveUrl(msgDesc.value);

      let isCodeTainted = false;
      if (codeDesc !== undefined) {
        if (codeDesc.get !== undefined || codeDesc.set !== undefined) {
          isCodeTainted = true;
        } else if (codeDesc.value !== undefined) {
          if (
            typeof codeDesc.value !== 'string' ||
            !APPROVED_CODES.has(codeDesc.value) ||
            hasSensitiveUrl(codeDesc.value)
          ) {
            isCodeTainted = true;
          }
        }
      }

      const isStackTainted =
        !stackDesc ||
        stackDesc.get !== undefined ||
        stackDesc.set !== undefined ||
        typeof stackDesc.value !== 'string' ||
        hasSensitiveUrl(stackDesc.value);

      const isTainted =
        !isStandardProtoChain ||
        !protoClean ||
        hasCause ||
        hasUnexpectedOwnKeys ||
        isNameTainted ||
        isMsgTainted ||
        isCodeTainted ||
        isStackTainted;

      if (isTainted) {
        const rawMsg = msgDesc && typeof msgDesc.value === 'string' ? msgDesc.value : undefined;
        const safeMsg = rawMsg
          ? stripCredentials(rawMsg)
          : safeContext
            ? `${safeContext}: Database operation failed`
            : 'Database operation failed';
        const finalMsg =
          safeContext && !safeMsg.startsWith(safeContext) ? `${safeContext}: ${safeMsg}` : safeMsg;
        const safeCode =
          codeDesc &&
          typeof codeDesc.value === 'string' &&
          APPROVED_CODES.has(codeDesc.value) &&
          !hasSensitiveUrl(codeDesc.value)
            ? codeDesc.value
            : rawMsg
              ? undefined
              : 'DATABASE_ERROR';

        return new DatabaseError(finalMsg, { code: safeCode });
      }

      const rawMsg = msgDesc!.value as string;
      const rawCode = codeDesc && typeof codeDesc.value === 'string' ? codeDesc.value : undefined;

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
