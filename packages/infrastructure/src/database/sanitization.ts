import util from 'node:util';

const REDACT_URL_REGEX = /postgres(ql)?:\/\/[^\s"'<>]+/gi;

export function stripCredentials(text: string): string {
  return text.replace(REDACT_URL_REGEX, 'postgresql://[REDACTED]');
}

export function hasSensitiveUrl(text: string): boolean {
  return stripCredentials(text) !== text;
}

export type SanitizationResult<T = unknown> =
  | { readonly status: 'safe'; readonly value: T }
  | { readonly status: 'sanitized'; readonly value: T }
  | { readonly status: 'unsanitizable' };

type DatabaseErrorFactory = (message: string) => Error;

let databaseErrorFactory: DatabaseErrorFactory = (message: string) => {
  const err = new Error(message);
  err.name = 'DatabaseError';
  return err;
};

export function setDatabaseErrorFactory(factory: DatabaseErrorFactory): void {
  databaseErrorFactory = factory;
}

let databaseErrorPrototype: object | undefined;

export function registerDatabaseErrorPrototype(proto: object): void {
  databaseErrorPrototype = proto;
}

export function getDatabaseError(message: string): Error {
  return databaseErrorFactory(message);
}

const CUSTOM_INSPECT_SYMBOL = Symbol.for('nodejs.util.inspect.custom');

const DANGEROUS_HOOK_KEYS: ReadonlySet<string | symbol> = new Set([
  'toJSON',
  'toString',
  'inspect',
  CUSTOM_INSPECT_SYMBOL,
  'valueOf',
  Symbol.toPrimitive,
  Symbol.iterator,
  Symbol.asyncIterator,
]);

const V8_ERROR_STACK_DESCRIPTOR = Object.getOwnPropertyDescriptor(new Error(), 'stack');
const V8_NATIVE_STACK_GETTER = V8_ERROR_STACK_DESCRIPTOR?.get;
const V8_NATIVE_STACK_SETTER = V8_ERROR_STACK_DESCRIPTOR?.set;

const ALLOWED_BUILTIN_PROTOS = new Set<object>([
  Object.prototype,
  Error.prototype,
  TypeError.prototype,
  RangeError.prototype,
  SyntaxError.prototype,
  ReferenceError.prototype,
  URIError.prototype,
  EvalError.prototype,
]);

export function hasProxyInPrototypeChain(obj: object): boolean {
  if (util.types.isProxy(obj)) {
    return true;
  }
  const visited = new Set<object>();
  let current: object | null = obj;
  while (current !== null) {
    if (util.types.isProxy(current)) {
      return true;
    }
    if (visited.has(current)) {
      return true;
    }
    visited.add(current);
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return true;
    }
  }
  return false;
}

function safeGetPrototypeOf(obj: object): object | null | undefined {
  if (util.types.isProxy(obj)) {
    return undefined;
  }
  try {
    return Object.getPrototypeOf(obj);
  } catch {
    return undefined;
  }
}

function safeOwnKeys(obj: object): (string | symbol)[] | null {
  if (util.types.isProxy(obj)) {
    return null;
  }
  try {
    return Reflect.ownKeys(obj);
  } catch {
    return null;
  }
}

function safeGetOwnPropertyDescriptor(
  obj: object,
  key: string | symbol,
): PropertyDescriptor | null | undefined {
  if (util.types.isProxy(obj)) {
    return null;
  }
  try {
    return Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return null;
  }
}

function safeIsFrozen(obj: object): boolean | null {
  if (util.types.isProxy(obj)) {
    return null;
  }
  try {
    return Object.isFrozen(obj);
  } catch {
    return null;
  }
}

function sanitizeObjectInPlace(obj: object, visited: Set<unknown>): boolean {
  if (util.types.isProxy(obj)) {
    return false;
  }
  if (hasProxyInPrototypeChain(obj)) {
    return false;
  }
  if (visited.has(obj)) {
    return true;
  }
  visited.add(obj);

  // 1. Prototype chain validation
  let currentProto = safeGetPrototypeOf(obj);
  if (currentProto === undefined) {
    return false;
  }

  const protoVisited = new Set<object>();

  while (currentProto !== null) {
    if (util.types.isProxy(currentProto)) {
      return false;
    }
    if (protoVisited.has(currentProto)) {
      return false;
    }
    protoVisited.add(currentProto);

    if (ALLOWED_BUILTIN_PROTOS.has(currentProto) || currentProto === databaseErrorPrototype) {
      break;
    }

    const protoKeys = safeOwnKeys(currentProto);
    if (!protoKeys) return false;
    for (const pKey of protoKeys) {
      if (pKey === 'constructor') continue;
      if (DANGEROUS_HOOK_KEYS.has(pKey)) return false;
      const pDesc = safeGetOwnPropertyDescriptor(currentProto, pKey);
      if (!pDesc) return false;
      if (pDesc.get !== undefined || pDesc.set !== undefined) return false;
    }
    currentProto = safeGetPrototypeOf(currentProto);
    if (currentProto === undefined) return false;
  }

  // 2. Own properties inspection
  const ownKeys = safeOwnKeys(obj);
  if (!ownKeys) return false;

  const isFrozen = safeIsFrozen(obj);
  if (isFrozen === null) return false;

  for (const key of ownKeys) {
    if (DANGEROUS_HOOK_KEYS.has(key)) {
      return false;
    }

    const desc = safeGetOwnPropertyDescriptor(obj, key);
    if (!desc) return false;

    // Check for accessors (getters/setters)
    if (desc.get !== undefined || desc.set !== undefined) {
      const isV8NativeStackAccessor =
        key === 'stack' &&
        desc.get === V8_NATIVE_STACK_GETTER &&
        desc.set === V8_NATIVE_STACK_SETTER;

      if (!isV8NativeStackAccessor) {
        return false;
      }

      if (V8_NATIVE_STACK_GETTER) {
        let rawStack: unknown;
        try {
          rawStack = V8_NATIVE_STACK_GETTER.call(obj);
        } catch {
          return false;
        }
        if (typeof rawStack === 'string' && hasSensitiveUrl(rawStack)) {
          if (isFrozen) return false;
          try {
            Object.defineProperty(obj, 'stack', {
              value: stripCredentials(rawStack),
              writable: true,
              configurable: true,
              enumerable: false,
            });
          } catch {
            return false;
          }
        }
      }
      continue;
    }

    // Plain data property
    const val = desc.value;
    if (typeof val === 'string') {
      if (hasSensitiveUrl(val)) {
        if (isFrozen) return false;
        try {
          Object.defineProperty(obj, key, {
            ...desc,
            value: stripCredentials(val),
          });
        } catch {
          return false;
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      if (!sanitizeObjectInPlace(val, visited)) {
        return false;
      }
    } else if (typeof val === 'function') {
      return false;
    }
  }

  return true;
}

export function sanitizeRejection<T = unknown>(val: T): SanitizationResult<T> {
  if (val === null || val === undefined) {
    return { status: 'safe', value: val };
  }
  if (
    typeof val === 'boolean' ||
    typeof val === 'number' ||
    typeof val === 'bigint' ||
    typeof val === 'symbol'
  ) {
    return { status: 'safe', value: val };
  }
  if (typeof val === 'string') {
    return hasSensitiveUrl(val) ? { status: 'unsanitizable' } : { status: 'safe', value: val };
  }
  if (typeof val !== 'object') {
    return { status: 'unsanitizable' };
  }

  try {
    const success = sanitizeObjectInPlace(val as object, new Set<unknown>());
    if (!success) {
      return { status: 'unsanitizable' };
    }
    return { status: 'sanitized', value: val };
  } catch {
    return { status: 'unsanitizable' };
  }
}

export function sanitizeCallbackError<E = unknown>(err: E): E | Error {
  const result = sanitizeRejection(err);
  if (result.status === 'safe' || result.status === 'sanitized') {
    return result.value;
  }
  return getDatabaseError('Transaction callback failed');
}
