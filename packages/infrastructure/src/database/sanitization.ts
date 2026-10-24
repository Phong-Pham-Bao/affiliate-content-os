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

export function getDatabaseError(message: string): Error {
  return databaseErrorFactory(message);
}

const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');

export function isValueSafe(val: unknown, visited = new Set<unknown>()): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === 'string') return !hasSensitiveUrl(val);
  if (typeof val !== 'object' && typeof val !== 'function') return true;
  if (visited.has(val)) return true;
  visited.add(val);

  const obj = val as Record<string | symbol, unknown>;
  if (typeof obj['message'] === 'string' && hasSensitiveUrl(obj['message'])) return false;
  if (typeof obj['stack'] === 'string' && hasSensitiveUrl(obj['stack'])) return false;
  if (typeof obj['cause'] === 'string' && hasSensitiveUrl(obj['cause'])) return false;
  if (
    typeof obj['cause'] === 'object' &&
    obj['cause'] !== null &&
    !isValueSafe(obj['cause'], visited)
  ) {
    return false;
  }

  for (const key of Reflect.ownKeys(obj)) {
    if (
      key === 'message' ||
      key === 'stack' ||
      key === 'cause' ||
      key === 'toJSON' ||
      key === customInspectSymbol ||
      key === 'toString'
    ) {
      continue;
    }
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(obj, key);
    } catch {
      continue;
    }
    if (!desc) continue;
    if (desc.get) {
      try {
        const v = desc.get.call(obj);
        if (typeof v === 'string' && hasSensitiveUrl(v)) return false;
        if (typeof v === 'object' && v !== null && !isValueSafe(v, visited)) return false;
      } catch {
        // ignore getter read error
      }
    } else if (desc.value !== undefined) {
      if (typeof desc.value === 'string' && hasSensitiveUrl(desc.value)) return false;
      if (
        typeof desc.value === 'object' &&
        desc.value !== null &&
        !isValueSafe(desc.value, visited)
      ) {
        return false;
      }
    }
  }

  const proto = Object.getPrototypeOf(obj);
  if (proto && proto !== Object.prototype && proto !== Error.prototype) {
    for (const key of Reflect.ownKeys(proto)) {
      if (
        key === 'constructor' ||
        key === 'toJSON' ||
        key === customInspectSymbol ||
        key === 'toString'
      ) {
        continue;
      }
      let desc: PropertyDescriptor | undefined;
      try {
        desc = Object.getOwnPropertyDescriptor(proto, key);
      } catch {
        continue;
      }
      if (desc?.get) {
        try {
          const v = desc.get.call(obj);
          if (typeof v === 'string' && hasSensitiveUrl(v)) return false;
          if (typeof v === 'object' && v !== null && !isValueSafe(v, visited)) return false;
        } catch {
          // ignore getter read error
        }
      }
    }
  }

  try {
    if (hasSensitiveUrl(String(obj))) return false;
  } catch {
    // ignore toString error
  }
  try {
    if (hasSensitiveUrl(util.inspect(obj, { depth: 5, showHidden: false }))) return false;
  } catch {
    // ignore inspect error
  }
  try {
    const json = JSON.stringify(obj);
    if (json && hasSensitiveUrl(json)) return false;
  } catch {
    // ignore circular json error
  }

  return true;
}

function trySetOrDefine(
  obj: Record<string | symbol, unknown>,
  key: string | symbol,
  value: unknown,
  enumerable = false,
): boolean {
  try {
    obj[key] = value;
    if (obj[key] === value) return true;
  } catch {
    // ignore assignment failure
  }
  try {
    Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable });
    if (obj[key] === value) return true;
  } catch {
    // ignore defineProperty failure
  }
  return false;
}

function sanitizeValuePure(val: unknown, visited: Set<unknown>): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') return stripCredentials(val);
  if (typeof val !== 'object' && typeof val !== 'function') return val;
  if (visited.has(val)) return val;
  visited.add(val);
  if (Array.isArray(val)) return val.map((item) => sanitizeValuePure(item, visited));
  const result: Record<string | symbol, unknown> = {};
  for (const key of Reflect.ownKeys(val)) {
    try {
      const desc = Object.getOwnPropertyDescriptor(val, key);
      if (desc && desc.enumerable && desc.value !== undefined) {
        result[key] = sanitizeValuePure(desc.value, visited);
      }
    } catch {
      // ignore descriptor read error
    }
  }
  return result;
}

function sanitizeInPlace(val: unknown, visited: Set<unknown>): boolean {
  if (val === null || val === undefined || (typeof val !== 'object' && typeof val !== 'function')) {
    return true;
  }
  if (visited.has(val)) return true;
  visited.add(val);
  if (Object.isFrozen(val)) return isValueSafe(val, new Set<unknown>());

  const obj = val as Record<string | symbol, unknown>;
  if (typeof obj['message'] === 'string' && hasSensitiveUrl(obj['message'])) {
    if (!trySetOrDefine(obj, 'message', stripCredentials(obj['message']), false)) return false;
  }
  if (typeof obj['stack'] === 'string' && hasSensitiveUrl(obj['stack'])) {
    if (!trySetOrDefine(obj, 'stack', stripCredentials(obj['stack']), false)) return false;
  }
  if (typeof obj['cause'] === 'string' && hasSensitiveUrl(obj['cause'])) {
    if (!trySetOrDefine(obj, 'cause', stripCredentials(obj['cause']), false)) return false;
  } else if (typeof obj['cause'] === 'object' && obj['cause'] !== null) {
    if (!sanitizeInPlace(obj['cause'], visited)) {
      const replacement = getDatabaseError('Database operation failed');
      if (!trySetOrDefine(obj, 'cause', replacement, false)) return false;
    }
  }

  if (typeof obj['toJSON'] === 'function') {
    const originalToJSON = obj['toJSON'] as (this: unknown, ...args: unknown[]) => unknown;
    try {
      Object.defineProperty(obj, 'toJSON', {
        value: function (this: unknown, ...args: unknown[]) {
          const res = originalToJSON.apply(this, args);
          return sanitizeValuePure(res, new Set<unknown>());
        },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      try {
        const res = (obj['toJSON'] as (this: unknown, ...args: unknown[]) => unknown).call(obj);
        if (!isValueSafe(res, new Set<unknown>())) return false;
      } catch {
        // ignore toJSON error
      }
    }
  }

  const customInspectFn = (obj[customInspectSymbol] ?? obj['inspect']) as
    ((this: unknown, ...args: unknown[]) => unknown) | undefined;
  if (typeof customInspectFn === 'function') {
    try {
      Object.defineProperty(obj, customInspectSymbol, {
        value: function (this: unknown, ...args: unknown[]) {
          const res = customInspectFn.apply(this, args);
          if (typeof res === 'string') return stripCredentials(res);
          return sanitizeValuePure(res, new Set<unknown>());
        },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      try {
        const res = customInspectFn.call(obj);
        if (!isValueSafe(res, new Set<unknown>())) return false;
      } catch {
        // ignore inspect error
      }
    }
  }

  if (
    typeof obj['toString'] === 'function' &&
    obj['toString'] !== Object.prototype.toString &&
    obj['toString'] !== Error.prototype.toString
  ) {
    const originalToString = obj['toString'] as (this: unknown, ...args: unknown[]) => string;
    try {
      Object.defineProperty(obj, 'toString', {
        value: function (this: unknown, ...args: unknown[]) {
          const res = originalToString.apply(this, args);
          return typeof res === 'string' ? stripCredentials(res) : res;
        },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      try {
        if (hasSensitiveUrl(originalToString.call(obj))) return false;
      } catch {
        // ignore toString error
      }
    }
  }

  for (const key of Reflect.ownKeys(obj)) {
    if (
      key === 'message' ||
      key === 'stack' ||
      key === 'cause' ||
      key === 'toJSON' ||
      key === customInspectSymbol ||
      key === 'toString'
    ) {
      continue;
    }
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(obj, key);
    } catch {
      continue;
    }
    if (!desc) continue;
    if (desc.get) {
      let v: unknown;
      try {
        v = desc.get.call(obj);
      } catch {
        continue;
      }
      if (typeof v === 'string' && hasSensitiveUrl(v)) {
        if (!desc.configurable) return false;
        const originalGet = desc.get;
        try {
          const accDesc: PropertyDescriptor = {
            configurable: true,
            get: function (this: unknown) {
              const res = originalGet.call(this);
              return typeof res === 'string' ? stripCredentials(res) : res;
            },
          };
          if (desc.enumerable !== undefined) {
            accDesc.enumerable = desc.enumerable;
          }
          if (desc.set !== undefined) {
            accDesc.set = desc.set;
          }
          Object.defineProperty(obj, key, accDesc);
        } catch {
          return false;
        }
      } else if (typeof v === 'object' && v !== null) {
        if (!sanitizeInPlace(v, visited)) return false;
      }
    } else if (desc.value !== undefined) {
      if (typeof desc.value === 'string' && hasSensitiveUrl(desc.value)) {
        if (!trySetOrDefine(obj, key, stripCredentials(desc.value), desc.enumerable ?? true)) {
          return false;
        }
      } else if (typeof desc.value === 'object' && desc.value !== null) {
        if (!sanitizeInPlace(desc.value, visited)) return false;
      }
    }
  }

  const proto = Object.getPrototypeOf(obj);
  if (proto && proto !== Object.prototype && proto !== Error.prototype) {
    for (const key of Reflect.ownKeys(proto)) {
      if (
        key === 'constructor' ||
        key === 'toJSON' ||
        key === customInspectSymbol ||
        key === 'toString'
      ) {
        continue;
      }
      let desc: PropertyDescriptor | undefined;
      try {
        desc = Object.getOwnPropertyDescriptor(proto, key);
      } catch {
        continue;
      }
      if (desc?.get) {
        let v: unknown;
        try {
          v = desc.get.call(obj);
        } catch {
          continue;
        }
        if (typeof v === 'string' && hasSensitiveUrl(v)) {
          if (!Object.isExtensible(obj)) return false;
          const originalGet = desc.get;
          try {
            const protoDesc: PropertyDescriptor = {
              configurable: true,
              get: function (this: unknown) {
                const res = originalGet.call(this);
                return typeof res === 'string' ? stripCredentials(res) : res;
              },
            };
            if (desc.enumerable !== undefined) {
              protoDesc.enumerable = desc.enumerable;
            }
            Object.defineProperty(obj, key, protoDesc);
          } catch {
            return false;
          }
        }
      }
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

  if (isValueSafe(val, new Set<unknown>())) {
    return { status: 'safe', value: val };
  }

  if (Object.isFrozen(val)) {
    return { status: 'unsanitizable' };
  }

  try {
    const success = sanitizeInPlace(val, new Set<unknown>());
    if (!success || !isValueSafe(val, new Set<unknown>())) {
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
