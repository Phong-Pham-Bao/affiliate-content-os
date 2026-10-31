# Implementation Report: TASK-004 Remediation 03

**Date:** 2026-10-27
**Task:** TASK-004 Remediation 03 (`tasks/TASK-004-REMEDIATION-03.md`)
**Status:** Completed
**Branch:** `agy/task-004-workspace-tenancy-core`

---

## 1. Root Causes and Fixes for the Three Codex Findings

### Finding 1: Unsanitized Cause Propagation and Closed Error Invariants

- **Severity**: HIGH
- **Root Cause**:
  1. `DatabaseError` exposed a public `cause?: unknown` property inherited from JavaScript's native `Error` and allowed arbitrary `cause` options in its constructor.
  2. While `toJSON()` and custom inspect attempted redaction, `cause` remained an enumerable/observable property on instances, accessible via `err.cause`, `Reflect.ownKeys()`, and Node's default error formatting when logging untyped error hierarchies.
  3. Hostile objects containing credential sentinels, getter traps, or recursive proxies could be passed into `DatabaseError`, leaking credentials or invoking untrusted side effects during error inspection or serialization.
- **Fix**:
  1. Removed `cause` completely from `DatabaseErrorOptions`.
  2. The `DatabaseError` constructor explicitly does not pass `cause` to `super()`, ensuring no `cause` own-property or standard prototype behavior is attached.
  3. `toJSON()` and `util.inspect.custom` enforce a closed, fixed representation containing only safe strings: `name: 'DatabaseError'`, `message`, and optionally `code`.
  4. Updated `sanitizeDatabaseError()`:
     - For existing `DatabaseError` instances, verified they are genuine, non-tainted instances without unexpected own properties or arbitrary causes. If tainted, returns a clean, safe `DatabaseError`.
     - For non-`DatabaseError` or driver errors, returns a new safe `DatabaseError` with a fixed safe message and optional code, without attaching any `cause` or raw driver properties.

### Finding 2: Unsafe Transaction Query Error Boundary and Non-Sticky Failure State

- **Severity**: CRITICAL
- **Root Cause**:
  1. In Remediation 02, in order to allow the adapter to catch unique violation errors, `TransactionExecutor.query()` was modified to let raw PostgreSQL errors pass directly through to the callback.
  2. As demonstrated by Codex's reproduction, this created two critical vulnerabilities:
     - **Information Leak**: The transaction callback could inspect the raw PostgreSQL driver error containing table names, SQL queries, database hostnames, or credentials.
     - **Fake Transaction Success / Non-Sticky State**: If user callback caught the query error and returned normally, `withTransaction()` proceeded to issue `COMMIT`. In PostgreSQL, after an error occurs inside a transaction block, the transaction is marked aborted. When `COMMIT` is executed on an aborted transaction, PostgreSQL issues a warning and executes a rollback behind the scenes, but the query resolves without an error! Thus, `withTransaction()` would resolve successfully with the callback's returned value, falsely reporting success when persistence actually failed.
     - If the callback caught the query failure and threw a secondary error, the original database failure would be lost.
- **Fix**:
  1. **Safe Query Boundary**: Wrapped `client.query()` inside `TransactionExecutor.query()` with `sanitizeDatabaseError(err, 'Database query execution failed')`. The callback receives only a safe, sanitized `DatabaseError` and never the raw PostgreSQL driver error.
  2. **Sticky Failure State**:
     - Introduced `firstQueryFailure: DatabaseError | null` in `withTransaction()`.
     - If any `tx.query()` call rejects, the first sanitized `DatabaseError` is captured as `firstQueryFailure`.
     - After any query rejection:
       - Never issue `COMMIT`.
       - Never resolve with the callback's return value (even if the callback caught the error and returned normally).
       - Never resolve with a replacement error thrown by the callback.
       - Attempt `ROLLBACK` at most once via `safeRollback()`.
       - Release the client exactly once via `safeRelease()`.
       - Reject unconditionally with `firstQueryFailure`.
  3. **Guaranteed Bounded Cleanup**:
     - Precedence preserved cleanly: Begin failure -> Query failure -> Callback failure -> Client error event -> Commit failure -> Release failure.
     - Release error is caught and logged; primary transaction failure is preserved.

### Finding 3: Ambiguous Exception Inspection for Slug Conflicts and Permissive Membership Timestamp

- **Severity**: HIGH
- **Root Cause**:
  1. **Slug Conflict**: The adapter relied on inspecting database error codes (`23505`) and constraint names (`workspaces_slug_unique`) from caught exceptions (`isSlugConflictError`). Because `TransactionExecutor.query()` now sanitizes all driver errors immediately, the raw driver error properties are never visible to the adapter.
  2. **Membership Timestamp**: In Remediation 02, `mapMembershipRow()` accepted `row.joined_at ?? null`, which silently treated `undefined` as valid `null`. This violated the rule that untrusted database rows must not allow missing or invalid properties to default silently.
- **Fix**:
  1. **Explicit SQL Conflict Path**:
     - Changed the workspace insertion statement to:
       `INSERT INTO workspaces (...) VALUES (...) ON CONFLICT (slug) DO NOTHING RETURNING id`
     - If a slug conflict occurs, PostgreSQL skips insertion and returns zero rows (`rowCount === 0`).
     - The adapter checks `if (wsResult.rowCount === 0)` and throws `new SlugConflictError(params.workspace.slug)`.
     - If any other constraint is violated (e.g., primary key, check constraint, connection failure), PostgreSQL raises a statement error, which is sanitized to `DatabaseError` and triggers sticky transaction failure.
     - Completely removed `isSlugConflictError()` and all raw code/constraint inspection from the tenancy adapter.
  2. **Strict Membership Timestamp Mapping**:
     - Updated `mapMembershipRow()`:
       `joined_at: row.joined_at === null ? null : mapRowTimestamp(row.joined_at, 'joined_at')`
     - Exactly `null` maps to `null`.
     - `undefined`, non-canonical strings, numbers, booleans, and invalid objects throw a credential-safe `DatabaseError`.

---

## 2. Exact Files Changed

### Modified

- `packages/infrastructure/src/database/errors.ts`:
  - Removed `cause` from `DatabaseErrorOptions` and constructor.
  - Omitted `cause` from `DatabaseError.toJSON()` and `util.inspect.custom`.
  - Hardened `sanitizeDatabaseError()` to ensure no arbitrary cause or properties are attached.
- `packages/infrastructure/src/database/database.ts`:
  - Wrapped `client.query` inside `TransactionExecutor.query` to sanitize raw errors before callback observation.
  - Implemented sticky `firstQueryFailure` tracking across the entire transaction lifecycle.
  - Implemented `safeRollback()` (at most once) and `safeRelease()` (exactly once).
  - Skips `COMMIT` and rejects with `firstQueryFailure` whenever any query fails.
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`:
  - Used `ON CONFLICT (slug) DO NOTHING RETURNING id` for atomic workspace insertion.
  - Mapped `rowCount === 0` to `SlugConflictError(params.workspace.slug)`.
  - Removed `isSlugConflictError` and all raw error property inspections.
- `packages/infrastructure/src/tenancy/mappers.ts`:
  - Updated `joined_at` handling to accept strictly `null` as nullable, rejecting `undefined` and invalid types.
- `packages/infrastructure/test/unit/errors.unit.test.ts`:
  - Added unit and adversarial tests for closed `DatabaseError` surface, cause omission, getter traps, proxy traps, and child-process sentinel validation.
- `packages/infrastructure/test/unit/database.unit.test.ts`:
  - Added comprehensive test suite for sticky transaction failure, raw error boundary sanitization, swallowed error prevention, multiple query failures, rollback/release ordering, and bounded cleanup.
- `packages/infrastructure/test/unit/tenancy-adapter.unit.test.ts`:
  - Updated fake database and tests to verify `rowCount === 0` explicit slug conflict mapping.
  - Added tests verifying non-conflict constraint violations map to `DatabaseError` and not `SlugConflictError`.
  - Added test matrix for `joined_at` proving exact `null` acceptance and `undefined` rejection.
- `packages/infrastructure/test/integration/database.integration.test.ts`:
  - Added real-PostgreSQL test proving that a caught statement error inside a transaction callback cannot report success, issues no commit, and persists no writes.

### Created

- `plans/261027-0006-task-004-remediation-03/plan.md`
- `plans/261027-0006-task-004-remediation-03/phase-01-database-error-closure.md`
- `plans/261027-0006-task-004-remediation-03/phase-02-transaction-query-boundary.md`
- `plans/261027-0006-task-004-remediation-03/phase-03-explicit-slug-conflict-and-timestamp.md`
- `plans/261027-0006-task-004-remediation-03/phase-04-verification-and-gates.md`
- `plans/reports/cook-261027-0006-task-004-remediation-03.md`

---

## 3. Verification and Security Test Results

All required verification commands and security scans passed:

| Gate / Command                    | Outcome              | Details                                                                               |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `verify:infrastructure-pins`      | PASSED               | Exact digest match for `postgres:18.6-bookworm`                                       |
| `docker compose config --quiet`   | PASSED               | Valid Compose configuration                                                           |
| `infra:up`                        | PASSED               | Isolated container running and healthy                                                |
| `db:migrate:validate`             | PASSED               | Clean migration from scratch; second run no-op; 2 checksums verified; dropped test db |
| `test:integration`                | PASSED               | 4 test files, 80 tests passing (including real PostgreSQL transaction rollback proof) |
| `format:check`                    | PASSED               | Prettier code style verified across repo                                              |
| `lint:boundaries`                 | PASSED               | Dependency Cruiser checked: 0 boundary violations                                     |
| `lint`                            | PASSED               | ESLint clean: 0 warnings, 0 errors                                                    |
| `typecheck`                       | PASSED               | TypeScript check clean across all 7 projects                                          |
| `test` (unit)                     | PASSED               | 22 test files, 625 unit tests passing                                                 |
| `build`                           | PASSED               | Clean production build across all packages and apps (including Next.js `apps/web`)    |
| `check`                           | PASSED               | Full local CI check pipeline clean                                                    |
| `audit --prod --audit-level high` | PASSED               | 0 high or critical npm vulnerabilities                                                |
| `verify:trivy-exception`          | PASSED               | Exception `TASK-003-CVE-2025-68121-GOSU` verified                                     |
| Trivy review scan                 | PASSED               | High/Critical review scan with ignorefile passed                                      |
| Trivy blocking scan               | PASSED               | High/Critical blocking scan with ignorefile passed (0 issues)                         |
| Trivy negative control scan       | PASSED (Exit code 1) | Correctly caught `CVE-2025-68121` without ignorefile                                  |
| `infra:down`                      | PASSED               | Clean container teardown                                                              |
| `git diff --check`                | PASSED               | No whitespace or line-ending errors                                                   |

---

## 4. Deviations and Unresolved Questions

- **Deviations**: None. Implemented exactly as specified in `tasks/TASK-004-REMEDIATION-03.md`.
- **Out of Scope Maintained**: No schema changes, migration changes, APIs, frontend UI, or domain contract changes.
