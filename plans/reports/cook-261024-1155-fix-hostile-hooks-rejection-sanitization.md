# Implementation Report: Fix Hostile Hooks & Database Error Classification

Date: 2026-10-24
Type: cook
Branch: agy/task-003-persistence-foundation

## Summary

Remediated the two HIGH security findings from the latest TASK-003 review:
1. **Finding 1 (Rejection sanitization invokes untrusted hooks)**: Eliminated untrusted getter invocations, stringification, inspection, and JSON serialization during rejection sanitization. Eliminated runtime wrappers around `toJSON`, `toString`, `inspect`, and property getters. Any object with an accessor, executable observability hook, custom prototype behavior, or hostile Proxy trap is replaced with a safe `DatabaseError` without attaching the original.
2. **Finding 2 (Raw database-error classification invokes hostile properties)**: Replaced direct property access (`err['code']`, `err['message']`) with a safe, total, non-throwing own-data-descriptor reader (`getSafeOwnStringProperty`). Hardened `classifyRawError` and `sanitizeDatabaseError` with total fail-safe boundaries that ignore hostile getters and Proxies, preventing trap exceptions from escaping and defaulting cleanly to generic `DatabaseError`.

## Root Cause Analysis

- **Finding 1**: `isValueSafe` and `sanitizeInPlace` previously called `desc.get.call(obj)`, `String(obj)`, `util.inspect(obj)`, and `JSON.stringify(obj)`, which invoked untrusted user-controlled hooks (such as custom inspect writing credentials to stderr). Furthermore, `sanitizeInPlace` installed wrapper functions that subsequently forwarded calls to the original untrusted hooks when the sanitized error was logged or inspected later.
- **Finding 2**: `classifyRawError` directly accessed `errorRecord['code']` and `errorRecord['message']`. When raw database errors or Proxies defined throwing getters on those properties, the thrown credential-bearing errors escaped `sanitizeDatabaseError` and propagated to callers unhandled.

## Changes Made

- `packages/infrastructure/src/database/sanitization.ts`:
  - Complete rewrite of object inspection to rely strictly on property descriptors inside fail-safe boundaries.
  - Prohibits invocation of getters, setters, and dangerous hooks (`toJSON`, `toString`, `inspect`, `nodejs.util.inspect.custom`, `valueOf`, `toPrimitive`, `iterator`).
  - Native V8 Error stack accessor is safely inspected and converted to a plain sanitized data descriptor.
  - Transparently identifies Proxies via native `util.types.isProxy` and rejects them without trap execution.
  - Preserves identity only for proven-safe values and falsy primitives.
- `packages/infrastructure/src/database/errors.ts`:
  - Added safe `getSafeOwnStringProperty` helper that inspects own data descriptors and ignores accessors.
  - Made `classifyRawError` total, non-throwing, and Proxy-safe.
  - Hardened `sanitizeDatabaseError` with full fail-safe boundary and strict `DatabaseError` descriptor validation.
  - Normalized `DatabaseError.stack` into a plain data property with stripped credentials.
- `packages/infrastructure/test/unit/database.unit.test.ts`:
  - Updated 3 tests to align with Finding 1 security guarantees (unsafe custom errors and accessors replaced with safe `DatabaseError`).
- `packages/infrastructure/test/unit/rejection-adversarial.unit.test.ts`:
  - Added 12 adversarial test cases covering side-effecting getters, throwing getters, `toJSON`, `toString`, `nodejs.util.inspect.custom`, `inspect`, `valueOf`/coercion, Proxy `get`/`getOwnPropertyDescriptor`/`ownKeys` traps, cyclic references with hostile hooks, and child-process reproduction.
- `packages/infrastructure/test/unit/classification-adversarial.unit.test.ts`:
  - Added 15 regression tests across `database.query`, `database.probe`, `pool connect`, transaction begin/query/commit/rollback, `client release`, `database.close`, and pool error handling.

## Verification Results

- `pnpm format:check`: Passed
- `pnpm lint`: Passed (0 errors, 0 warnings)
- `pnpm lint:boundaries`: Passed (0 violations)
- `pnpm typecheck`: Passed (all packages and apps)
- `pnpm test`: Passed (17 test files, 256 passed)
- `pnpm test:integration`: Passed (2 test files, 19 passed)
- `pnpm verify:infrastructure-pins`: Passed
- `pnpm verify:trivy-exception`: Passed
- `pnpm check`: Passed
- `pnpm db:migrate:status`: Passed (1 applied, 0 drift)
- `pnpm db:migrate:validate`: Passed
