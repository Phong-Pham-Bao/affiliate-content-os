# Research: Proxy Prototype Chain Traversal and DatabaseError Identity

## Findings & Root Cause Analysis

### 1. Prototype Chain Traversal in Sanitization

In `packages/infrastructure/src/database/sanitization.ts`:
`sanitizeObjectInPlace(obj)` checks `if (util.types.isProxy(obj))` for the input object itself.
However, when `obj` is an ordinary object with a Proxy as its prototype (`Object.setPrototypeOf(obj, proxy)` or `Object.create(proxy)`):
`currentProto` becomes the Proxy.
The while loop checks:
`!ALLOWED_BUILTIN_PROTOS.has(currentProto) && currentProto !== databaseErrorPrototype`
Since the Proxy is neither, it immediately calls:

- `safeOwnKeys(currentProto)` -> `Reflect.ownKeys(currentProto)` triggering the Proxy's `ownKeys` trap.
- `safeGetPrototypeOf(currentProto)` -> `Object.getPrototypeOf(currentProto)` triggering the Proxy's `getPrototypeOf` trap.

### 2. DatabaseError Identity via `instanceof`

In `packages/infrastructure/src/database/errors.ts`:
`sanitizeDatabaseError(err)` performs:

```ts
isDbError = err instanceof DatabaseError;
```

Under ECMAScript specifications, `instanceof` triggers `Function.prototype[Symbol.hasInstance]`, which traverses the prototype chain using `[[GetPrototypeOf]]`.
When `err` has a Proxy in its prototype chain:
Traversing into the Proxy triggers the Proxy's `getPrototypeOf` trap.
Any throwing trap or credential-exposing getter can leak information or escape classification.

## Remediation Design

1. **Proxy Detection on Prototypes**:
   - Introduce `hasProxyInPrototypeChain(obj: object): boolean` using Node's `util.types.isProxy`.
   - Before reflecting or advancing via `Object.getPrototypeOf`, verify the prototype is not a Proxy.
   - Halt traversal immediately if any prototype is a Proxy or cannot be inspected safely.

2. **Hook-Free Identity Brand**:
   - Create private `WeakSet<object>` for genuine `DatabaseError` instances.
   - Register instances in `DatabaseError` constructor.
   - Check identity via `isDatabaseError(value: unknown): value is DatabaseError` using `WeakSet.prototype.has`.
   - Completely eliminate `instanceof DatabaseError` checks on untrusted values.
