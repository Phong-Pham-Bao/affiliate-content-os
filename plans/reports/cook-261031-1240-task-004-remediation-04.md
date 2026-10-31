# Implementation Report: TASK-004 Remediation 04

**Date:** 2026-10-31
**Task:** TASK-004 Remediation 04 (`tasks/TASK-004-REMEDIATION-04.md`)
**Status:** Completed
**Branch:** `agy/task-004-workspace-tenancy-core`

---

## 1. Root Causes and Architectural Remediation

### Finding 1: Unquiescent In-Flight Transaction Queries

- **Severity**: HIGH
- **Root Cause**:
  1. `TransactionExecutor.query()` allowed queries started while the transaction callback was executing to remain in flight when the callback returned or threw.
  2. If a callback settled early while a query was still pending in the PostgreSQL driver (e.g. unawaited fire-and-forget query or multi-query concurrency), `withTransaction()` proceeded immediately to `COMMIT` or `ROLLBACK` and released the client back to the pool while the query was still in progress.
  3. This created severe race conditions: a late query could fail after `COMMIT` was issued or after the connection was released and checked out by an unrelated caller, causing data corruption or connection cross-talk.
- **Fix**:
  1. **In-Flight Query Tracking**:
     - Introduced an internal `inFlightQueries = new Set<Promise<void>>()` within `withTransaction()`.
     - Whenever `tx.query()` is invoked, if `!active`, the query is immediately rejected.
     - When active, the driver query is accepted and wrapped in a safe `completionPromise = callerPromise.then(() => {}, () => {})` that settles safely without unhandled rejections, and removes itself from `inFlightQueries` in a `finally` block.
  2. **Quiescence Enforcement**:
     - Immediately upon callback settlement (return or throw), `active = false` deactivates the executor so no new queries can be accepted.
     - Before making any decision to `COMMIT` or `ROLLBACK`, `withTransaction()` awaits quiescence:
       `while (inFlightQueries.size > 0) { await Promise.all(Array.from(inFlightQueries)); }`
     - Only after every in-flight query has settled does `withTransaction()` evaluate whether to commit or rollback.
  3. **Sticky Query Failure Precedence**:
     - If any registered query rejected, `COMMIT` is never executed.
     - The first query failure (`firstQueryFailure`) remains the primary transaction failure across normal callback return, callback replacement error, client error event, rollback failure, or release failure.
     - The database client is never released while any query remains in flight.

### Finding 2: Genuine DatabaseError Callback Rejections and Observable Surface Closure

- **Severity**: HIGH
- **Root Cause**:
  1. Callback rejections that were genuine `DatabaseError` instances were routed through generic recursive `sanitizeCallbackError()`, which preserved them in place without deep surface inspection.
  2. If a caller mutated a genuine `DatabaseError` after construction (e.g. attaching `cause`, PostgreSQL constraint, raw SQL, bind parameters, credentials, symbols, accessors, or hostile stack traces), those properties remained observable.
- **Fix**:
  1. **Direct Routing**:
     - In `withTransaction()` catch handler and in `sanitizeCallbackError()`, genuine `DatabaseError` instances (`isDatabaseError(err)`) are routed directly to `sanitizeDatabaseError(err)`.
  2. **Observable Surface Closure**:
     - `sanitizeDatabaseError()` validates genuine `DatabaseError` instances against a strict closed invariant without invoking getters, proxies, `toJSON`, `toString`, coercion, or prototype hooks:
       - Prototype chain must strictly equal `DatabaseError.prototype -> Error.prototype -> Object.prototype -> null`.
       - `DatabaseError.prototype` own keys must contain no unexpected properties.
       - No own or inherited `cause` property may exist (`causeDesc === undefined && !('cause' in err)`).
       - Own keys permitted on the instance are strictly limited to `'name'`, `'message'`, `'code'`, `'stack'`. Any symbols or unexpected properties immediately mark the error as tainted.
       - Descriptors must be value properties (no getters or setters).
       - `code` must be either `undefined` or present in `APPROVED_CODES` allowlist.
       - `message` and `stack` must be strings without credential/URL sentinels.
  3. **Safe Replacement Without In-Place Mutation**:
     - If any tainted property is detected, a fresh safe `DatabaseError` is returned (`new DatabaseError(err.message, { code: safeCode })`).
     - The caller-owned error object is never mutated in place.
     - Identity is preserved only if the observable surface is completely safe and closed.
     - Non-database business errors continue to preserve their semantics and messages through approved sanitization paths.

---

## 2. In-Flight Query Ownership & Command Sequences

### Successful In-Flight Drainage:

1. `BEGIN` issued to client.
2. Callback runs, launches `tx.query(A)` (unawaited) and returns `'success'`.
3. Executor immediately deactivates (`active = false`). Any further `tx.query()` rejects.
4. Transaction waits for in-flight set: awaits query A.
5. Query A succeeds and settles.
6. In-flight set reaches size 0.
7. Evaluates state: `firstQueryFailure === null`, no callback error.
8. `COMMIT` issued to client.
9. Client safely released once.
10. `withTransaction()` resolves with callback result.

### Failing In-Flight Drainage:

1. `BEGIN` issued to client.
2. Callback runs, launches `tx.query(A)` (unawaited, fails later in driver) and returns `'success'`.
3. Executor immediately deactivates (`active = false`).
4. Transaction waits for in-flight set: awaits query A.
5. Query A rejects. Caller-facing promise captures rejection; internal completion promise captures rejection into `firstQueryFailure = sanitizeDatabaseError(err)`.
6. In-flight set reaches size 0.
7. Evaluates state: `firstQueryFailure` is non-null. `COMMIT` is prohibited.
8. `safeRollback()` issues `ROLLBACK` at most once.
9. `safeRelease()` releases client exactly once.
10. `withTransaction()` rejects with `firstQueryFailure`.

---

## 3. Exact Files Changed

### Modified

- `packages/infrastructure/src/database/database.ts`:
  - Added in-flight query registration and tracking via `Set<Promise<void>>`.
  - Enforced executor deactivation on callback settlement and quiescence drain before commit/rollback.
  - Ensured `COMMIT` is never issued if any query failed, and client is never released while queries are pending.
  - Routed genuine `DatabaseError` callback rejections to `sanitizeDatabaseError()`.
- `packages/infrastructure/src/database/errors.ts`:
  - Defined `APPROVED_CODES` allowlist.
  - Routed `isDatabaseError(err)` in `sanitizeCallbackError()` to `sanitizeDatabaseError(err)`.
  - Implemented strict observable surface validation for genuine `DatabaseError` instances without getters/proxies/hooks.
  - Replaced tainted `DatabaseError` with a fresh safe instance without mutating the original in place.
- `packages/infrastructure/test/unit/database.unit.test.ts`:
  - Added 9 unit tests covering unawaited successful query drainage, unawaited failing query preventing commit without unhandled rejections, controlled concurrency order, callback failure with pending queries, client/rollback/release failures after late query failure, and executor reuse rejection.
- `packages/infrastructure/test/unit/errors.unit.test.ts`:
  - Added comprehensive test suite for genuine tainted `DatabaseError` instances covering enumerable/non-enumerable/accessor causes, constraints, SQL, bind parameters, credentials, hostile stacks, symbols, unexpected keys, and child process stdout/stderr sentinel proof.
- `packages/infrastructure/test/integration/database.integration.test.ts`:
  - Added 2 real-PostgreSQL tests verifying delayed successful query drainage and delayed failing query rollback and non-persistence.

### Created

- `plans/261031-1215-task-004-remediation-04/plan.md`
- `plans/261031-1215-task-004-remediation-04/phase-01-in-flight-query-tracking.md`
- `plans/261031-1215-task-004-remediation-04/phase-02-database-error-closure-and-routing.md`
- `plans/261031-1215-task-004-remediation-04/phase-03-regression-test-suites.md`
- `plans/261031-1215-task-004-remediation-04/phase-04-verification-and-gates.md`
- `plans/reports/cook-261031-1240-task-004-remediation-04.md`

---

## 4. Verification and Security Test Results

| Gate / Command                                  | Outcome              | Details                                                                                                                                                   |
| ----------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm format:check`                    | PASSED               | Prettier code style verified across all files                                                                                                             |
| `corepack pnpm lint:boundaries`                 | PASSED               | Depcruise: 0 dependency boundary violations (234 modules, 467 dependencies)                                                                               |
| `corepack pnpm lint`                            | PASSED               | ESLint clean: 0 errors, 0 warnings                                                                                                                        |
| `corepack pnpm typecheck`                       | PASSED               | TypeScript check clean across all 7 workspace projects                                                                                                    |
| `corepack pnpm test` (unit)                     | PASSED               | 22 test files, 638 passed (100% pass rate)                                                                                                                |
| `corepack pnpm build`                           | PASSED               | Full production build clean across all packages and Next.js app                                                                                           |
| `corepack pnpm check`                           | PASSED               | Full local CI check pipeline clean                                                                                                                        |
| `corepack pnpm audit --prod --audit-level high` | PASSED               | 0 high or critical vulnerabilities                                                                                                                        |
| `corepack pnpm verify:infrastructure-pins`      | PASSED               | Pinned digest verified: `postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc`                                  |
| `node scripts/verify-trivy-exception.mjs`       | PASSED               | Exception `TASK-003-CVE-2025-68121-GOSU` verified                                                                                                         |
| `docker compose config --quiet`                 | PASSED               | Valid Docker Compose configuration                                                                                                                        |
| Trivy review scan                               | PASSED               | HIGH,CRITICAL review scan with ignorefile passed (exit code 0)                                                                                            |
| Trivy blocking scan                             | PASSED               | CRITICAL scan with ignorefile passed: 0 unfixed vulnerabilities (exit code 0)                                                                             |
| Trivy negative control scan                     | PASSED (Exit code 1) | Correctly caught `CVE-2025-68121` without ignorefile                                                                                                      |
| `git diff --check`                              | PASSED               | 0 whitespace or formatting errors                                                                                                                         |
| Local Docker Daemon                             | UNAVAILABLE          | Windows `com.docker.service` is stopped and requires administrator permissions. PostgreSQL service container integration suite runs on GitHub Actions CI. |

---

## 5. Deviations and Out-of-Scope Integrity

- **No deviations**: Implemented strictly per `tasks/TASK-004-REMEDIATION-04.md`.
- **Preserved contracts**: No changes to database schema, migrations, slug conflict SQL, timestamp mapping, domain/application contracts, API/worker/web behavior, CI policies, dependency versions, or security exceptions.
