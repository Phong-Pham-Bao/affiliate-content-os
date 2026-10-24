# Phase 01: Prototype Proxy Detection & Hook-Free DatabaseError Brand

## Context Links

- [TASK-003 Specification](../../tasks/TASK-003.md)
- [TASK-003 Remediation 01](../../tasks/TASK-003-REMEDIATION-01.md)
- [Architecture Documentation](../../docs/ARCHITECTURE.md)
- [Database Error Implementation](../../packages/infrastructure/src/database/errors.ts)
- [Sanitization Implementation](../../packages/infrastructure/src/database/sanitization.ts)

## Overview

- Priority: High
- Status: Complete
- Resolve the vulnerability where an ordinary rejected object with a Proxy in its prototype chain triggers `ownKeys` / `getPrototypeOf` traps during sanitization or `err instanceof DatabaseError`.

## Key Insights

- `Object.getPrototypeOf(obj)` on an ordinary object returns the prototype slot without invoking hooks on that prototype.
- Before reflecting or operating on any prototype, check `util.types.isProxy(proto)`.
- If a prototype is a Proxy, stop traversal immediately, treat as unsanitizable, and replace with a fresh `DatabaseError`.
- `instanceof DatabaseError` on an untrusted value traverses prototypes using `[[GetPrototypeOf]]`, firing Proxy `getPrototypeOf` traps.
- Replace `instanceof DatabaseError` with a module-private `WeakSet<object>` brand.
- Every genuine `DatabaseError` (and normally constructed subclass) registers in the WeakSet during construction.

## Requirements

1. Hook-free Proxy detection (`util.types.isProxy`) before inspecting or traversing any prototype.
2. If any prototype is a Proxy, stop immediately and return a safe `DatabaseError` without attaching original.
3. No operations on detected Proxies (`Reflect.ownKeys`, `Object.getPrototypeOf`, `getOwnPropertyDescriptor`, property access, `instanceof`, etc.).
4. Hook-free `DatabaseError` brand via private `WeakSet<object>` replacing `err instanceof DatabaseError`.
5. Preserve genuine `DatabaseError` instances, subclasses, normal errors, and frozen objects.
6. Comprehensive regression test coverage for Cases A and B.

## Architecture

- `sanitization.ts`:
  - `hasProxyInPrototypeChain(obj)` hook-free traversal checking `util.types.isProxy` before `Object.getPrototypeOf`.
  - In `sanitizeObjectInPlace`, detect Proxy prototypes and abort without invoking traps.
  - Guard `safeGetPrototypeOf`, `safeOwnKeys`, `safeGetOwnPropertyDescriptor`, `safeIsFrozen` against Proxy targets.
- `errors.ts`:
  - `const GENUINE_DATABASE_ERRORS = new WeakSet<object>();`
  - Constructor adds `this` to `GENUINE_DATABASE_ERRORS`.
  - `isDatabaseError(err)` predicate using `GENUINE_DATABASE_ERRORS.has(err)`.
  - Replace `err instanceof DatabaseError` in `sanitizeDatabaseError` with `isDatabaseError(err)`.
  - In `sanitizeDatabaseError` and `classifyRawError`, check `hasProxyInPrototypeChain(err)`.

## Related Code Files

- Modify: `packages/infrastructure/src/database/sanitization.ts`
- Modify: `packages/infrastructure/src/database/errors.ts`
- Modify / Add tests:
  - `packages/infrastructure/test/unit/rejection-adversarial.unit.test.ts`
  - `packages/infrastructure/test/unit/classification-adversarial.unit.test.ts`
  - `packages/infrastructure/test/unit/errors.unit.test.ts`

## Implementation Steps

1. Add `hasProxyInPrototypeChain(obj: object): boolean` in `sanitization.ts`.
2. Guard all helper reflection functions against Proxy values.
3. Update `sanitizeObjectInPlace` to halt on Proxy prototype values.
4. Implement `GENUINE_DATABASE_ERRORS` WeakSet and `isDatabaseError` in `errors.ts`.
5. Replace `err instanceof DatabaseError` with `isDatabaseError(err)` in `sanitizeDatabaseError`.
6. Add `hasProxyInPrototypeChain` guard in `sanitizeDatabaseError` and `classifyRawError`.
7. Add regression tests for Case A (transaction sanitizer with Proxy in prototype chain).
8. Add regression tests for Case B (database error classification with Proxy in prototype chain).
9. Add tests proving genuine DatabaseError, subclasses, normal Error, frozen Error, and direct/nested Proxies pass.
10. Run all quality gates, container scans, and clean checkout verification.

## Todo List

- [x] Implement `hasProxyInPrototypeChain` and prototype check in `sanitization.ts`
- [x] Implement `GENUINE_DATABASE_ERRORS` and `isDatabaseError` in `errors.ts`
- [x] Replace `err instanceof DatabaseError` in `errors.ts`
- [x] Add regression tests in `rejection-adversarial.unit.test.ts`
- [x] Add regression tests in `classification-adversarial.unit.test.ts`
- [x] Add unit tests in `errors.unit.test.ts`
- [x] Run full test suite and quality gates
- [x] Run container scan and negative control

## Success Criteria

- Zero trap invocations when ordinary rejected object has Proxy in prototype chain.
- No `instanceof` prototype traversal on untrusted rejections.
- All 13 verification commands pass.
- Remote commit pushed cleanly without branch change.
