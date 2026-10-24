const REDACT_URL_REGEX = /postgres(ql)?:\/\/[^\s"'<>]+/gi;

export function stripCredentials(text: string): string {
  return text.replace(REDACT_URL_REGEX, 'postgresql://[REDACTED]');
}

const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');

/**
 * Sanitizes a single value recursively, scrubbing credential-bearing URLs from all
 * observable surfaces (messages, stacks, properties, accessors, toJSON, util.inspect).
 */
function sanitizeValue<T>(val: T, visited: Set<unknown>): T {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === 'string') {
    return stripCredentials(val) as T;
  }

  if (typeof val !== 'object' && typeof val !== 'function') {
    return val;
  }

  if (visited.has(val)) {
    return val;
  }
  visited.add(val);

  const obj = val as Record<string | symbol, unknown>;

  // 1. Sanitize standard Error fields if present
  if (typeof obj['message'] === 'string') {
    try {
      obj['message'] = stripCredentials(obj['message']);
    } catch {
      // accessor or non-writable
    }
  }

  if (typeof obj['stack'] === 'string') {
    try {
      obj['stack'] = stripCredentials(obj['stack']);
    } catch {
      // accessor or non-writable
    }
  }

  if (typeof obj['cause'] === 'string') {
    try {
      obj['cause'] = stripCredentials(obj['cause']);
    } catch {
      // accessor or non-writable
    }
  } else if (obj['cause'] !== undefined) {
    try {
      obj['cause'] = sanitizeValue(obj['cause'], visited);
    } catch {
      // accessor or non-writable
    }
  }

  // 2. Wrap custom toJSON if function exists on obj or prototype
  if (typeof obj['toJSON'] === 'function') {
    const originalToJSON = obj['toJSON'] as (this: unknown, ...args: unknown[]) => unknown;
    try {
      Object.defineProperty(obj, 'toJSON', {
        value: function (this: unknown, ...args: unknown[]) {
          const res = originalToJSON.apply(this, args);
          return sanitizeValue(res, new Set<unknown>());
        },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      // non-configurable or frozen
    }
  }

  // 3. Wrap custom inspect function if present
  const customInspectFn = (obj[customInspectSymbol] ?? obj['inspect']) as
    ((this: unknown, ...args: unknown[]) => unknown) | undefined;

  if (typeof customInspectFn === 'function') {
    try {
      Object.defineProperty(obj, customInspectSymbol, {
        value: function (this: unknown, ...args: unknown[]) {
          const res = customInspectFn.apply(this, args);
          if (typeof res === 'string') {
            return stripCredentials(res);
          }
          return sanitizeValue(res, new Set<unknown>());
        },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      // non-configurable or frozen
    }
  }

  // 4. Wrap custom toString if present and distinct from Object/Error prototype
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
      // non-configurable or frozen
    }
  }

  // 5. Inspect and sanitize own properties and accessors
  const ownKeys = Reflect.ownKeys(obj);
  for (const key of ownKeys) {
    if (key === 'toJSON' || key === customInspectSymbol || key === 'toString') {
      continue;
    }
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(obj, key);
    } catch {
      continue;
    }
    if (!desc) {
      continue;
    }

    if (desc.get) {
      // Accessor property
      const originalGet = desc.get;
      if (desc.configurable) {
        try {
          const newDesc: PropertyDescriptor = {
            configurable: desc.configurable,
            get: function (this: unknown) {
              const res = originalGet.call(this);
              return sanitizeValue(res, visited);
            },
          };
          if (desc.enumerable !== undefined) {
            newDesc.enumerable = desc.enumerable;
          }
          if (desc.set !== undefined) {
            newDesc.set = desc.set;
          }
          Object.defineProperty(obj, key, newDesc);
        } catch {
          // ignore defineProperty error
        }
      }
    } else if (desc.value !== undefined) {
      if (typeof desc.value === 'string') {
        const sanitized = stripCredentials(desc.value);
        if (sanitized !== desc.value) {
          try {
            if (desc.writable) {
              obj[key] = sanitized;
            } else if (desc.configurable) {
              const valDesc: PropertyDescriptor = {
                value: sanitized,
              };
              if (desc.writable !== undefined) {
                valDesc.writable = desc.writable;
              }
              if (desc.enumerable !== undefined) {
                valDesc.enumerable = desc.enumerable;
              }
              if (desc.configurable !== undefined) {
                valDesc.configurable = desc.configurable;
              }
              Object.defineProperty(obj, key, valDesc);
            }
          } catch {
            // ignore non-writable
          }
        }
      } else if (typeof desc.value === 'object' && desc.value !== null) {
        sanitizeValue(desc.value, visited);
      }
    }
  }

  // 6. Inspect custom class prototype accessors (below Error.prototype / Object.prototype)
  const proto = Object.getPrototypeOf(obj);
  if (proto && proto !== Object.prototype && proto !== Error.prototype) {
    const protoKeys = Reflect.ownKeys(proto);
    for (const key of protoKeys) {
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
      if (desc && desc.get) {
        const originalGet = desc.get;
        try {
          const protoDesc: PropertyDescriptor = {
            configurable: true,
            get: function (this: unknown) {
              const res = originalGet.call(this);
              return sanitizeValue(res, visited);
            },
          };
          if (desc.enumerable !== undefined) {
            protoDesc.enumerable = desc.enumerable;
          }
          Object.defineProperty(obj, key, protoDesc);
        } catch {
          // ignore
        }
      }
    }
  }

  return val;
}

export function sanitizeCallbackError<E = unknown>(err: E): E {
  if (err === undefined) {
    return undefined as E;
  }
  try {
    return sanitizeValue(err, new Set<unknown>());
  } catch {
    // A sanitizer failure must never erase or replace the primary transaction failure with undefined
    return err;
  }
}
