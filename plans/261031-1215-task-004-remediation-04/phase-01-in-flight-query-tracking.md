# Phase 01: In-Flight Transaction Query Tracking and Quiescence

## Context Links

- Specification: [TASK-004-REMEDIATION-04.md](file:///C:/Users/Win%2010/affiliate-content-os/tasks/TASK-004-REMEDIATION-04.md)
- Target file: [database.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/src/database/database.ts)

## Overview

Implement transaction-local registration, asynchronous completion tracking, and quiescence in `withTransaction()` to ensure every accepted query settles before commit/rollback/release decisions.

## Architecture & Implementation Steps

1. In `withTransaction`:
   - Initialize `const inFlightQueries = new Set<Promise<void>>();`
   - `let active = true;` (set after `BEGIN` succeeds; `false` on begin failure or in callback `finally`).
   - In `executor.query(text, params)`:
     - Check `if (!active)` -> reject with `Cannot execute query: transaction has already completed`.
     - Atomically wrap `client.query` execution.
     - `callerPromise`: maps rows/result on success; on rejection, immediately sanitizes to safe `DatabaseError`, records `firstQueryFailure` (if undefined), and throws safe error.
     - `completionPromise`: attaches `() => {}, () => {}` to `callerPromise`. This:
       a) prevents unhandled rejection if the caller doesn't attach `.catch()`;
       b) settles safely without throwing;
       c) settles strictly after `firstQueryFailure` is recorded.
     - Add `completionPromise` to `inFlightQueries`, and delete it in `completionPromise.finally`.
     - Return `callerPromise` to caller.
2. In callback lifecycle:
   - When callback settles, set `active = false` immediately in `finally`.
   - Await `while (inFlightQueries.size > 0) { await Promise.all(Array.from(inFlightQueries)); }`.
   - Quiescence complete: all registered queries are settled, and no new queries can register.
3. Decision sequence:
   - If `firstQueryFailure !== undefined`:
     - attempt rollback once;
     - release client once;
     - throw `firstQueryFailure`.
   - If `beginFailed`: rollback once, release once, throw `beginFailureValue`.
   - If `callbackFailed`: rollback once, release once, throw `callbackFailureValue`.
   - If `clientError`: rollback once, release once, throw `safeClientErr`.
   - Attempt `COMMIT`: if fails, rollback once, release once, throw `safeCommitErr`.
   - If `COMMIT` succeeds: release client once. If release error, throw sanitized release error. Otherwise return `callbackResult`.
   - Cleanup: `inFlightQueries.clear()`.

## Todo List

- [ ] Implement `inFlightQueries` tracking in `withTransaction`
- [ ] Implement quiescence `await Promise.all(Array.from(inFlightQueries))` before decisions
- [ ] Verify first-query-failure sticky precedence across all failure states
- [ ] Ensure `active = false` immediately prevents executor reuse during drain
