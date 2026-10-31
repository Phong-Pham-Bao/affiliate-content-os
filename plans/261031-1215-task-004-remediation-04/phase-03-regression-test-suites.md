# Phase 03: Regression Test Suites

## Context Links

- Specification: [TASK-004-REMEDIATION-04.md](file:///C:/Users/Win%2010/affiliate-content-os/tasks/TASK-004-REMEDIATION-04.md)
- Target files:
  - [database.unit.test.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/test/unit/database.unit.test.ts)
  - [errors.unit.test.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/test/unit/errors.unit.test.ts)
  - [database.integration.test.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/test/integration/database.integration.test.ts)

## Overview

Add comprehensive unit, adversarial, and real-PostgreSQL integration regression tests for in-flight transaction query lifecycle tracking and tainted genuine `DatabaseError` routing.

## Test Matrix

1. Unit tests in `database.unit.test.ts`:
   - Unawaited delayed successful query completes before `COMMIT` and release.
   - Unawaited delayed failed query prevents `COMMIT` and successful resolution.
   - Test with caller-attached catch and without caller-attached catch.
   - Prove no `unhandledRejection` event or raw sentinel output.
   - Controlled settlement order of several concurrent queries (mix of success and failures).
   - Callback failure while queries remain pending (query success vs query failure).
   - Client error, rollback failure, and release failure after a late query failure.
   - Executor reuse rejected with `Cannot execute query: transaction has already completed` while earlier queries are draining.
2. Unit and child-process tests in `errors.unit.test.ts`:
   - Callback throwing genuine `DatabaseError` tainted with:
     - enumerable `cause`
     - non-enumerable `cause`
     - accessor-backed `cause`
     - `constraint`
     - `sql` / `query`
     - `bind` / `params`
     - credentials in message, code, or stack
     - hostile stack
     - `Symbol` property
     - unexpected own keys
   - Prove identity is preserved ONLY when closed, completely safe, and untampered.
   - Prove caller-owned error is never mutated in place.
   - Prove no getters, proxies, toJSON, toString, custom inspection, coercion, or prototype hooks are executed.
   - Prove child-process stdout/stderr contains zero sentinels.
3. Real PostgreSQL tests in `database.integration.test.ts`:
   - Unawaited query completes before `COMMIT` in real PostgreSQL.
   - Unawaited delayed failure in real PostgreSQL rolls back prior writes, prevents commit, and leaves no persisted rows.

## Todo List

- [ ] Add in-flight query unit tests to `database.unit.test.ts`
- [ ] Add tainted `DatabaseError` tests to `errors.unit.test.ts`
- [ ] Add real-PostgreSQL in-flight integration tests to `database.integration.test.ts`
