# Phase 03: Adversarial Tests and Reproductions

## Context Links

- tasks/TASK-004-REMEDIATION-05.md
- packages/infrastructure/test/unit/database.unit.test.ts
- packages/infrastructure/test/unit/errors.unit.test.ts

## Overview

Status: planned
Priority: high

Add focused unit and adversarial test suites covering all query-result mapping and DatabaseError mutation cases required by TASK-004 Remediation 05.

## Test Matrix

1. Query lifecycle mapping tests in `database.unit.test.ts`:
   - `rows` getter throws raw error with sentinels
   - `rows` iterator throws raw error
   - `rowCount` getter throws raw error
   - `command` getter throws raw error
   - Proxy-backed result or rows trap throws
   - Awaited vs unawaited variants
   - Caller catch vs no caller catch
   - Prior successful write followed by mapping failure
   - Controlled concurrent query settlement
   - Assert: safe `DatabaseError`, raw sentinels absent, first failure sticky, NO COMMIT, rollback at most once, release exactly once, no unhandledRejection
2. DatabaseError tests in `errors.unit.test.ts`:
   - Replace `DatabaseError.prototype.toJSON`
   - Replace custom inspection
   - Replace `toString`
   - Replace stack with non-URL SQL, bind, password, token, constraint, newline, and stack-frame sentinels
   - Add enumerable and non-enumerable unexpected properties
   - Add symbol properties
   - Add hostile accessors
   - Change instance prototype
   - Proxy and ambiguous values
   - Child process stdout/stderr sentinel verification
   - Preservation of non-database business errors
