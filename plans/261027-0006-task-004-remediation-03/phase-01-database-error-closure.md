# Phase 01: Database Error Closure

## Context

- `tasks/TASK-004-REMEDIATION-03.md` Section 1
- `packages/infrastructure/src/database/errors.ts`
- `packages/infrastructure/src/database/sanitization.ts`

## Requirements

- Remove `cause` from `DatabaseError` constructor options type and implementation.
- Remove `cause` from `toJSON()` and custom inspect symbol output.
- `DatabaseError` must not retain, inherit, or serialize arbitrary causes.
- `sanitizeDatabaseError` never attaches inspected error as `cause`.
- In `sanitizeDatabaseError`, check genuine `DatabaseError` instances for any `cause` or unexpected properties; if present, do not return as-is, return fresh safe `DatabaseError`.
- Ensure application/callback business errors thrown directly in transaction callbacks are still preserved by `sanitizeCallbackError`.

## Implementation Steps

1. Edit `packages/infrastructure/src/database/errors.ts`:
   - Update `DatabaseError` constructor: remove `cause` from options. Delete `this.cause`.
   - Update `toJSON()` and `[Symbol.for('nodejs.util.inspect.custom')]`: omit `cause`.
   - In `sanitizeDatabaseError`: ensure genuine `DatabaseError` check verifies no `cause` or unapproved fields exist.
2. Add adversarial tests in `packages/infrastructure/test/unit/errors.unit.test.ts`.
