# Phase 02: DatabaseError Closure, Validation, and Routing

## Context Links

- Specification: [TASK-004-REMEDIATION-04.md](file:///C:/Users/Win%2010/affiliate-content-os/tasks/TASK-004-REMEDIATION-04.md)
- Target files:
  - [errors.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/src/database/errors.ts)
  - [sanitization.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/src/database/sanitization.ts)
  - [database.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/src/database/database.ts)

## Overview

Ensure genuine `DatabaseError` callback rejections are routed through `sanitizeDatabaseError()` without being processed by the generic in-place recursive sanitizer, and validate their complete observable surface without executing getters, proxies, or hooks.

## Architecture & Implementation Steps

1. In `database.ts`:
   - In callback `catch (userErr)`:
     ```ts
     callbackFailureValue = isDatabaseError(userErr)
       ? sanitizeDatabaseError(userErr)
       : sanitizeCallbackError(userErr);
     ```
2. In `errors.ts`:
   - Define approved code allowlist `APPROVED_CODES`.
   - Update `sanitizeCallbackError`: if `isDatabaseError(err)`, delegate directly to `sanitizeDatabaseError(err)`.
   - In `sanitizeDatabaseError`:
     - Inspect `isDatabaseError(err)`.
     - Verify complete prototype chain:
       - `Object.getPrototypeOf(err) === DatabaseError.prototype`
       - `Object.getPrototypeOf(DatabaseError.prototype) === Error.prototype`
       - `Object.getPrototypeOf(Error.prototype) === Object.prototype`
       - `DatabaseError.prototype` own keys are only standard (`constructor`, `toJSON`, custom inspect symbol).
     - Verify cause absence:
       - `Object.getOwnPropertyDescriptor(err, 'cause') === undefined`
       - `!('cause' in err)`
     - Verify own keys:
       - `Reflect.ownKeys(err)` contains ONLY `'name'`, `'message'`, `'stack'`, and optionally `'code'`. No symbols, no extra keys (`constraint`, `sql`, `bind`, etc.).
     - Verify descriptors:
       - `name`: data property, `desc.value === 'DatabaseError'`, no getter/setter.
       - `message`: data property, `typeof desc.value === 'string'`, no getter/setter, `!hasSensitiveUrl(desc.value)`.
       - `code`: if present, data property, `typeof desc.value === 'string'`, no getter/setter, `APPROVED_CODES.has(desc.value)`, `!hasSensitiveUrl(desc.value)`.
       - `stack`: data property, `typeof desc.value === 'string'`, no getter/setter, `!hasSensitiveUrl(desc.value)`.
     - If ANY check fails or indicates tampering:
       - Return a fresh safe `DatabaseError` with sanitized message and approved safe code.
       - Do NOT mutate `err` in place.
       - Do NOT execute any getters, proxies, hooks, or serialization.
     - If ALL checks pass:
       - If `safeContext && !rawMsg.startsWith(safeContext)`, return new `DatabaseError` with prefix.
       - Otherwise, preserve identity `return err as DatabaseError`.

## Todo List

- [ ] Route `isDatabaseError` rejections in `withTransaction` and `sanitizeCallbackError`
- [ ] Harden `sanitizeDatabaseError` validation of genuine `DatabaseError` observable surface
- [ ] Ensure no getters/proxies/hooks are executed and no in-place mutation occurs
