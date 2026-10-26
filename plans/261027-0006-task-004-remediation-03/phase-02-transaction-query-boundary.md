# Phase 02: Transaction Query Boundary and Sticky Failure

## Context

- `tasks/TASK-004-REMEDIATION-03.md` Sections 2 and 3
- `packages/infrastructure/src/database/database.ts`

## Requirements

- `TransactionExecutor.query()` must wrap `client.query()` in a try/catch block.
- On rejection:
  - Sanitize the error immediately with `sanitizeDatabaseError(err, 'Database query execution failed')`.
  - Record the first safe query rejection as `firstQueryFailure` (if not already set).
  - Throw only the safe `DatabaseError` to the transaction callback.
- Sticky failure semantics in `withTransaction()`:
  - If `firstQueryFailure` is set:
    - Never issue `COMMIT`.
    - Never resolve with callback return value.
    - Attempt `ROLLBACK` once.
    - Release client exactly once.
    - Reject with `firstQueryFailure`.
    - Later callback return, callback error, client error, rollback error, or release error must not replace `firstQueryFailure`.
  - If no query failed (`firstQueryFailure === undefined`):
    - Preserve existing primary callback error, client error, commit error, rollback, and release precedence.
  - Set `active = false` upon callback completion and keep executor inactive.

## Implementation Steps

1. Edit `packages/infrastructure/src/database/database.ts`.
2. Add comprehensive unit tests in `packages/infrastructure/test/unit/database.unit.test.ts`.
3. Add real PostgreSQL test in `packages/infrastructure/test/integration/database.integration.test.ts`.
