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

interface TrustedConstructionState {
  readonly safeMessage: string;
  readonly safeCode: string | undefined;
  readonly originalStack: string | undefined;
}

const GENUINE_DATABASE_ERRORS = new WeakSet<object>();
const TRUSTED_CONSTRUCTION_STATE = new WeakMap<object, TrustedConstructionState>();

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
    const safeMessage =
      typeof message === 'string' ? stripCredentials(message) : 'Database operation failed';
    super(safeMessage);
    this.name = 'DatabaseError';

    let safeCode: string | undefined;
    if (options && typeof options === 'object') {
      try {
        const desc = Object.getOwnPropertyDescriptor(options, 'code');
        if (
          desc &&
          desc.get === undefined &&
          desc.set === undefined &&
          typeof desc.value === 'string'
        ) {
          if (APPROVED_CODES.has(desc.value) && !hasSensitiveUrl(desc.value)) {
            safeCode = desc.value;
          }
        }
      } catch {
        safeCode = undefined;
      }
    }
    if (safeCode !== undefined) {
      this.code = safeCode;
    }

    let initialStack: string | undefined;
    if (this.stack && typeof this.stack === 'string') {
      initialStack = stripCredentials(this.stack);
      try {
        Object.defineProperty(this, 'stack', {
          value: initialStack,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch {
        this.stack = initialStack;
      }
    }

    GENUINE_DATABASE_ERRORS.add(this);
    TRUSTED_CONSTRUCTION_STATE.set(this, {
      safeMessage,
      safeCode,
      originalStack: initialStack,
    });
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

  public override toString(): string {
    return this.message ? `${this.name}: ${this.message}` : this.name;
  }
}

const ORIGINAL_TO_JSON = DatabaseError.prototype.toJSON;
const ORIGINAL_CUSTOM_INSPECT = (DatabaseError.prototype as unknown as Record<symbol, unknown>)[
  Symbol.for('nodejs.util.inspect.custom')
];
const ORIGINAL_TO_STRING = DatabaseError.prototype.toString;
const ORIGINAL_CONSTRUCTOR = DatabaseError;
const ORIGINAL_ERROR_TO_STRING = Error.prototype.toString;

const SAFE_DATABASE_ERROR_PROTOTYPE = Object.create(Error.prototype);
Object.defineProperties(SAFE_DATABASE_ERROR_PROTOTYPE, {
  name: {
    value: 'DatabaseError',
    writable: false,
    configurable: false,
    enumerable: false,
  },
  toJSON: {
    value: ORIGINAL_TO_JSON,
    writable: false,
    configurable: false,
    enumerable: false,
  },
  [Symbol.for('nodejs.util.inspect.custom')]: {
    value: ORIGINAL_CUSTOM_INSPECT,
    writable: false,
    configurable: false,
    enumerable: false,
  },
  toString: {
    value: ORIGINAL_TO_STRING,
    writable: false,
    configurable: false,
    enumerable: false,
  },
  constructor: {
    value: DatabaseError,
    writable: false,
    configurable: false,
    enumerable: false,
  },
});
Object.freeze(SAFE_DATABASE_ERROR_PROTOTYPE);

registerDatabaseErrorPrototype(DatabaseError.prototype);
registerDatabaseErrorPrototype(SAFE_DATABASE_ERROR_PROTOTYPE);

function isDatabaseErrorProtoClean(): boolean {
  try {
    const proto = DatabaseError.prototype;
    const protoKeys = Reflect.ownKeys(proto);
    for (const k of protoKeys) {
      if (
        k !== 'constructor' &&
        k !== 'toJSON' &&
        k !== Symbol.for('nodejs.util.inspect.custom') &&
        k !== 'toString'
      ) {
        return false;
      }
      const desc = Object.getOwnPropertyDescriptor(proto, k);
      if (!desc || desc.get !== undefined || desc.set !== undefined) {
        return false;
      }
      if (k === 'constructor' && desc.value !== ORIGINAL_CONSTRUCTOR) {
        return false;
      }
      if (k === 'toJSON' && desc.value !== ORIGINAL_TO_JSON) {
        return false;
      }
      if (
        k === Symbol.for('nodejs.util.inspect.custom') &&
        desc.value !== ORIGINAL_CUSTOM_INSPECT
      ) {
        return false;
      }
      if (k === 'toString' && desc.value !== ORIGINAL_TO_STRING) {
        return false;
      }
    }
    if (Error.prototype.toString !== ORIGINAL_ERROR_TO_STRING) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function createFreshSafeDatabaseError(message: string, code: string | undefined): DatabaseError {
  const fresh = new DatabaseError(message, { code });
  if (!isDatabaseErrorProtoClean()) {
    Object.setPrototypeOf(fresh, SAFE_DATABASE_ERROR_PROTOTYPE);
  }
  return fresh;
}

setDatabaseErrorFactory((message: string) =>
  createFreshSafeDatabaseError(message, 'DATABASE_ERROR'),
);

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
      util.types.isProxy(err) ||
      hasProxyInPrototypeChain(err as object)
    ) {
      return createFreshSafeDatabaseError(fallbackMessage, 'DATABASE_ERROR');
    }

    const isDbError = isDatabaseError(err);

    if (isDbError) {
      const trusted = TRUSTED_CONSTRUCTION_STATE.get(err as object);
      if (!trusted) {
        return createFreshSafeDatabaseError(fallbackMessage, 'DATABASE_ERROR');
      }

      let isStandardProtoChain = false;
      try {
        const p1 = Object.getPrototypeOf(err);
        if (p1 === DatabaseError.prototype || p1 === SAFE_DATABASE_ERROR_PROTOTYPE) {
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

      const protoClean = isDatabaseErrorProtoClean();

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
        const ownKeys = Reflect.ownKeys(err as object);
        for (const k of ownKeys) {
          if (typeof k !== 'string') {
            hasUnexpectedOwnKeys = true;
            break;
          }
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
        return createFreshSafeDatabaseError(fallbackMessage, 'DATABASE_ERROR');
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
        msgDesc.value !== trusted.safeMessage;

      const isCodeTainted =
        trusted.safeCode !== undefined
          ? !codeDesc ||
            codeDesc.get !== undefined ||
            codeDesc.set !== undefined ||
            codeDesc.value !== trusted.safeCode
          : codeDesc !== undefined &&
            (codeDesc.get !== undefined ||
              codeDesc.set !== undefined ||
              codeDesc.value !== undefined);

      const isStackTainted =
        !stackDesc ||
        stackDesc.get !== undefined ||
        stackDesc.set !== undefined ||
        typeof stackDesc.value !== 'string' ||
        stackDesc.value !== trusted.originalStack;

      const isTainted =
        !isStandardProtoChain ||
        !protoClean ||
        hasCause ||
        hasUnexpectedOwnKeys ||
        isNameTainted ||
        isMsgTainted ||
        isCodeTainted ||
        isStackTainted;

      const safeMsg = trusted.safeMessage;
      const finalMsg =
        safeContext && !safeMsg.startsWith(safeContext) ? `${safeContext}: ${safeMsg}` : safeMsg;
      const safeCode = trusted.safeCode ?? 'DATABASE_ERROR';

      if (isTainted) {
        return createFreshSafeDatabaseError(finalMsg, safeCode);
      }

      if (safeContext && !trusted.safeMessage.startsWith(safeContext)) {
        return createFreshSafeDatabaseError(finalMsg, safeCode);
      }

      return err as DatabaseError;
    }

    const classification = classifyRawError(err);
    const message = safeContext
      ? `${safeContext}: ${classification.message}`
      : classification.message;

    return createFreshSafeDatabaseError(message, classification.code);
  } catch {
    return createFreshSafeDatabaseError(fallbackMessage, 'DATABASE_ERROR');
  }
}
