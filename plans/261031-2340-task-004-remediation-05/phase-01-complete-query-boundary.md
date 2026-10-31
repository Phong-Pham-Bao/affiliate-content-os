# Phase 01: Complete Query Boundary

## Context Links

- tasks/TASK-004-REMEDIATION-05.md
- packages/infrastructure/src/database/database.ts

## Overview

Status: planned
Priority: high

Put parameter copying, `client.query()` invocation, driver promise awaiting, `rows` access, row iteration, `rowCount` access, `command` access, result creation, and result freezing inside one try/catch boundary.

## Implementation Steps

1. In `TransactionExecutor.query`:
   - Replace sibling `.then(success, failure)` on driverPromise with single async execution boundary.
   - Enclose parameter copying (`params ? [...params] : undefined`), `await client.query(...)`, `res.rows`, row iteration, `res.rowCount`, `res.command`, and `Object.freeze(...)` inside `try/catch`.
   - On error at any point: sanitize with `sanitizeDatabaseError(err, 'Database query execution failed')`, set sticky `firstQueryFailure` if not yet set, and rethrow safe error.
   - Attach non-rejecting completion observer (`callerPromise.then(() => {}, () => {})`), add to `inFlightQueries`, and delete on `finally`.
   - Return `callerPromise`.
2. Apply matching robust query lifecycle in `createDatabase`'s `query` method.
