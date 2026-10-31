# Cook Report: TASK-004 Remediation 05 Implementation

**Task:** TASK-004 Remediation 05  
**Date:** 2026-10-31  
**Time:** 23:40  
**Branch:** `agy/task-004-workspace-tenancy-core`  
**PR:** https://github.com/Phong-Pham-Bao/affiliate-content-os/pull/4

---

## 1. Reproduced Root Causes

Before making any code changes, both Codex findings were reproduced in isolated test harnesses:

### Finding 1: Result-Mapping Failure Outside Query Boundary

- **Reproduction**: Injected an accessor error into `result.rows` during a transaction query inside `withTransaction()`.
- **Observed Behavior**: The caller promise was rejected with the raw, unsanitized driver error (`RawDriverError: Hostile rows getter execution`). The query failure occurred within the `.then(onSuccess, onFailure)` success handler of the driver promise. Because sibling handlers were used, errors thrown in `onSuccess` were not caught by `onFailure`. Consequently, `firstQueryFailure` remained `null`. When caller code swallowed the rejection, `withTransaction()` proceeded to execute `COMMIT`, followed by `RELEASE`, committing transactions despite data mapping failure and exposing raw driver identities.

### Finding 2: `DatabaseError` Safety Determined by Mutable Surface & Replaceable Methods

- **Reproduction**:
  1. Mutated `DatabaseError.prototype.toJSON = () => ({ LEAKED_PAYLOAD: 'PW_SENTINEL_SECRET' })`. Tested with `sanitizeDatabaseError(err)`. The error preserved identity (`err === sanitized`) and serialized the secret payload when inspected via `JSON.stringify()`.
  2. Mutated `err.stack` with a non-URL SQL sentinel `Error: custom\n at select * from users where password = 'secret'`. Because the stack did not contain `postgres://` or connection URLs, the previous regex-based sanitization accepted the mutated stack and preserved identity, leaking query/password text.

---

## 2. Complete Query Boundary Implementation

### Execution Boundary Enclosure

In `packages/infrastructure/src/database/database.ts`:

- Refactored `TransactionExecutor.query` and pool `query` so that the entire query lifecycle is wrapped in a single `async` execution boundary with `try / catch`:
  1. Parameter cloning / validation
  2. `client.query(text, params)` driver execution
  3. Awaiting driver result
  4. Reading `rows`, iterating and shallow copying `rows`
  5. Reading `rowCount` and `command`
  6. Constructing frozen `QueryResult`
- If an exception occurs at **any** of these steps (including hostile getters, proxy traps, iteration errors, or driver rejections):
  - The error is immediately routed to `sanitizeDatabaseError(err)`.
  - The sticky `firstQueryFailure` on the transaction state is set (if not already populated).
  - The safe `DatabaseError` is thrown, rejecting the caller-facing promise.
- Preserved Remediation 04 in-flight tracking:
  - An internal non-rejecting completion observer (`callerPromise.then(() => {}, () => {})`) is registered in `inFlightQueries`.
  - When the transaction finishes draining, `firstQueryFailure` guarantees that `COMMIT` is prohibited.
  - Exactly one rollback attempt is executed.
  - The client is released exactly once.
  - No unhandled rejections escape into the Node.js runtime.

---

## 3. Trusted `DatabaseError` State & Immutable Prototype

### Module-Private Construction State

In `packages/infrastructure/src/database/errors.ts`:

- Created a module-private `WeakMap`:
  ```typescript
  const TRUSTED_CONSTRUCTION_STATE = new WeakMap<object, TrustedConstructionState>();
  ```
- Stored fields contain only safe primitives: `{ safeMessage: string, safeCode?: string, originalStack?: string }`.
- Zero raw causes, constraints, SQL, bind parameters, driver instances, or caller objects are stored in trusted state.

### Immutable Fallback Prototype (`SAFE_DATABASE_ERROR_PROTOTYPE`)

- Captured original method references at module evaluation time before user code executes:
  - `ORIGINAL_TO_JSON`
  - `ORIGINAL_CUSTOM_INSPECT`
  - `ORIGINAL_TO_STRING`
  - `ORIGINAL_CONSTRUCTOR`
- Created a frozen prototype `SAFE_DATABASE_ERROR_PROTOTYPE` with immutable methods delegates directly to the captured original functions.
- In `packages/infrastructure/src/database/sanitization.ts`, registered `SAFE_DATABASE_ERROR_PROTOTYPE` alongside `DatabaseError.prototype` in `allowedDatabasePrototypes`.

### Strict Fail-Closed Validation

In `sanitizeDatabaseError(err)`:

1. Verifies `TRUSTED_CONSTRUCTION_STATE.get(err)`. If missing, the error is untrusted and replaced with a fresh generic safe `DatabaseError`.
2. Inspects prototype clean state: prototype must be `DatabaseError.prototype` or `SAFE_DATABASE_ERROR_PROTOTYPE` with original un-tampered function descriptors.
3. Uses `Reflect.getOwnPropertyDescriptor` without invoking getters, coercions, or proxies.
4. Validates stack identity: `stackDesc.value === trusted.originalStack`. If stack was replaced, modified, or made into an accessor (even without URLs), validation fails closed.
5. Rejects any unexpected own properties or symbols.
6. If any check fails, creates a fresh safe `DatabaseError` derived strictly from trusted state (`trusted.safeMessage`, `trusted.safeCode`), setting its prototype to `SAFE_DATABASE_ERROR_PROTOTYPE` if `DatabaseError.prototype` is poisoned.
7. Never mutates caller-owned objects in place.

---

## 4. Transaction Command Sequences

### Scenario A: Normal Clean Query

1. Client checkout: `BEGIN` issued.
2. `tx.query(sql, params)` executed:
   - Parameters copied.
   - Driver query executed and awaited.
   - Rows accessed, copied, frozen.
   - `QueryResult` returned.
3. Callback finishes.
4. `COMMIT` issued.
5. Client released (1 release).

### Scenario B: Result Mapping Throws (Adversarial Rows Getter)

1. Client checkout: `BEGIN` issued.
2. `tx.query('SELECT 1', [])` called. Driver completes query successfully.
3. Query boundary accesses `rawResult.rows` -> hostile getter throws `Hostile rows getter error`.
4. Boundary `catch` catches error:
   - Sanitizes to `DatabaseError: Database operation failed`.
   - Records `firstQueryFailure = sanitizedErr`.
   - Throws `sanitizedErr` to caller.
5. Callback swallows the rejection and returns.
6. `withTransaction()` examines `firstQueryFailure`: non-null!
7. `COMMIT` prohibited.
8. `ROLLBACK` issued exactly once.
9. Client released exactly once.
10. `withTransaction()` rejects with `firstQueryFailure`.

### Scenario C: Controlled Late Query Failure

1. `BEGIN` issued.
2. Callback launches unawaited query that fails late, returns immediately.
3. Executor deactivates (`active = false`).
4. `withTransaction()` awaits in-flight query set.
5. Query boundary catches failure, sanitizes, records `firstQueryFailure`.
6. Quiescence drain completes.
7. `COMMIT` prohibited; `ROLLBACK` issued once; client released once.
8. `withTransaction()` rejects with safe `DatabaseError`.

---

## 5. Summary of Adversarial Tests

### Query Boundary Tests (`database.unit.test.ts`)

- `rows` getter throws: Sanitized to safe `DatabaseError`, recorded in `firstQueryFailure`, prohibits `COMMIT`, triggers `ROLLBACK`, client released once.
- `rows` iterator throws: Sanitized to safe `DatabaseError`, records failure, triggers `ROLLBACK`.
- `rowCount` getter throws: Sanitized to safe `DatabaseError`, records failure, triggers `ROLLBACK`.
- `command` getter throws: Sanitized to safe `DatabaseError`, records failure, triggers `ROLLBACK`.
- Proxy-backed result trap throws: Sanitized to safe `DatabaseError`, triggers `ROLLBACK`.
- Awaited query failure: Rejects caller with safe `DatabaseError`.
- Unawaited query failure: No unhandled rejection; internal observer registers failure and prohibits `COMMIT`.
- Prior successful write followed by mapping failure: Write rolled back, zero persistence.
- Zero raw identity, credential, or sentinel leaked in thrown errors.

### `DatabaseError` Invariants Tests (`errors.unit.test.ts`)

- Replaced `DatabaseError.prototype.toJSON`: Replaces error with fresh safe instance backed by `SAFE_DATABASE_ERROR_PROTOTYPE`; zero hostile hook execution.
- Replaced custom inspect: Fails closed to safe instance.
- Replaced `toString`: Fails closed to safe instance.
- Modified stack with non-URL SQL / password / token sentinels: Fails closed; sanitized error contains original safe stack.
- Added unexpected own properties (enumerable & non-enumerable): Fails closed.
- Added symbol properties: Fails closed.
- Added hostile accessors: Never executes hostile getters; fails closed.
- Changed instance prototype: Fails closed.
- Child process regression: Proves no hostile hook runs in `JSON.stringify()`, `util.inspect()`, or `String()`.
- Preserved non-database business error semantics: `sanitizeCallbackError()` cleanly preserves standard business errors.

---

## 6. Exact Files Changed

### Modified

- `packages/infrastructure/src/database/sanitization.ts`:
  - Extended allowed database prototypes to include `SAFE_DATABASE_ERROR_PROTOTYPE`.
- `packages/infrastructure/src/database/errors.ts`:
  - Implemented `TRUSTED_CONSTRUCTION_STATE` `WeakMap`.
  - Created immutable `SAFE_DATABASE_ERROR_PROTOTYPE`.
  - Hardened `sanitizeDatabaseError()` to fail closed on prototype tampering, stack modification, or unexpected properties without executing getters or mutating caller errors.
- `packages/infrastructure/src/database/database.ts`:
  - Wrapped complete query execution, driver await, result access, mapping, and freezing in single `async try/catch` boundary.
  - Linked all query mapping failures to `firstQueryFailure` and safe error rejection.
- `packages/infrastructure/test/unit/database.unit.test.ts`:
  - Added comprehensive adversarial query mapping and boundary test suite.
- `packages/infrastructure/test/unit/errors.unit.test.ts`:
  - Added comprehensive trusted state, prototype poisoning, and stack mutation test suite.

### Created

- `plans/261031-2340-task-004-remediation-05/plan.md`
- `plans/261031-2340-task-004-remediation-05/phase-01-complete-query-boundary.md`
- `plans/261031-2340-task-004-remediation-05/phase-02-trusted-database-error-state.md`
- `plans/261031-2340-task-004-remediation-05/phase-03-adversarial-tests-and-reproductions.md`
- `plans/261031-2340-task-004-remediation-05/phase-04-verification-and-gates.md`
- `plans/reports/cook-261031-2340-task-004-remediation-05.md`

---

## 7. Verification Results

| Verification Check        | Command                                         | Status               | Details                                                                                  |
| ------------------------- | ----------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| Node.js Version           | `node --version`                                | PASSED               | `v24.14.0`                                                                               |
| pnpm Version              | `corepack pnpm --version`                       | PASSED               | `12.4.2`                                                                                 |
| Frozen Lockfile Install   | `corepack pnpm install --frozen-lockfile`       | PASSED               | Lockfile up to date                                                                      |
| Local Environment Setup   | `corepack pnpm env:local`                       | PASSED               | `.env` generated and verified                                                            |
| Docker Compose Config     | `docker compose config --quiet`                 | PASSED               | Compose config valid                                                                     |
| Infrastructure Pins       | `corepack pnpm verify:infrastructure-pins`      | PASSED               | PostgreSQL digest verified against registry                                              |
| Infrastructure Startup    | `corepack pnpm infra:up`                        | PASSED               | PostgreSQL container started and healthy (5/5)                                           |
| Migration Validation      | `corepack pnpm db:migrate:validate`             | PASSED               | Clean baseline, idempotent rerun, isolated DB cleaned up                                 |
| Full Integration Suite    | `corepack pnpm test:integration`                | PASSED               | 4 test files, 82 passed (100%)                                                           |
| Code Formatting           | `corepack pnpm format:check`                    | PASSED               | All files formatted per Prettier                                                         |
| Boundary Linting          | `corepack pnpm lint:boundaries`                 | PASSED               | 234 modules, 467 dependencies, 0 violations                                              |
| Linting                   | `corepack pnpm lint`                            | PASSED               | ESLint clean (0 errors, 0 warnings)                                                      |
| Type Checking             | `corepack pnpm typecheck`                       | PASSED               | All 7 workspace projects clean                                                           |
| Unit Tests                | `corepack pnpm test`                            | PASSED               | 22 test files, 655 tests passed (100%)                                                   |
| Workspace Build           | `corepack pnpm build`                           | PASSED               | All packages and Next.js app built cleanly                                               |
| Aggregate Check           | `corepack pnpm check`                           | PASSED               | Full local CI check pipeline clean (code 0)                                              |
| Production Audit          | `corepack pnpm audit --prod --audit-level high` | PASSED               | 0 high or critical vulnerabilities                                                       |
| Security Exception Policy | `corepack pnpm verify:trivy-exception`          | PASSED               | Exception `TASK-003-CVE-2025-68121-GOSU` verified                                        |
| Pinned Image Inspection   | `docker image inspect`                          | PASSED               | Digest `sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc` matches |
| Trivy Review Scan         | `trivy image ... HIGH,CRITICAL`                 | PASSED               | Exit code 0, 1 suppressed finding                                                        |
| Trivy Blocking Scan       | `trivy image ... CRITICAL --ignore-unfixed`     | PASSED               | Exit code 0, 0 unfixed critical vulnerabilities                                          |
| Trivy Negative Control    | `trivy image ... without ignorefile`            | PASSED (Exit code 1) | Accurately flagged `CVE-2025-68121` on `usr/local/bin/gosu`                              |
| Runtime Smoke Tests       | API & Worker smoke scripts                      | PASSED               | API returned HTTP 200 on `/health/live`; Worker started and stopped gracefully           |
| Infrastructure Shutdown   | `corepack pnpm infra:down`                      | PASSED               | Container and network removed cleanly                                                    |
| Git Diff Check            | `git diff --check`                              | PASSED               | 0 whitespace or formatting errors                                                        |

---

## 8. Commit and PR State

- **Local HEAD**: Will be recorded upon commit.
- **Remote Branch**: `origin/agy/task-004-workspace-tenancy-core`
- **Pull Request**: #4 (`https://github.com/Phong-Pham-Bao/affiliate-content-os/pull/4`)
- **PR Merge Rule**: PR #4 is **NOT** merged, strictly adhering to instructions.

---

## 9. Deviations, Skipped Checks, or Limitations

- **None**: All required verification commands, integration suites, unit test suites, security scans, negative controls, and smoke tests were executed directly and passed without skips or workarounds.
