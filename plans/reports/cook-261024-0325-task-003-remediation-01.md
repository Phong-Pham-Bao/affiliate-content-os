# Implementation Report: TASK-003 Remediation 01

- **Date:** 2026-10-24
- **Branch:** `agy/task-003-persistence-foundation`
- **Specification:** `tasks/TASK-003-REMEDIATION-01.md`
- **Status:** Complete

---

## 1. Root Cause Analysis & Fix for Each Finding

### Finding 1: Broken Docker Security Scan and Overly Broad OS Suppression

- **Root Cause:** Trivy scanning previously failed in CI when encountering `CVE-2025-68121` on `/usr/local/bin/gosu` in Debian Bookworm base image. An earlier workaround attempted to restrict scanning to OS packages or suppress entire scanner types, bypassing vulnerability scanning across binaries.
- **Fix:**
  - Applied formally approved, narrow, file-path-scoped, time-bounded exception in `.trivyignore.yaml` targeting only `usr/local/bin/gosu`, `CVE-2025-68121`, expiring `2026-12-31`.
  - Documented exception per policy in `security/exceptions/TASK-003-CVE-2025-68121-GOSU.md` with complete rationale, non-reachability analysis, image digest, and upstream tracking links.
  - Added strict validator script `scripts/verify-trivy-exception.mjs` wired into `package.json` (`verify:trivy-exception`) and `.github/workflows/ci.yml`.
  - Kept full Trivy vulnerability scanning enabled (`--scanners vuln`), passing `--ignorefile .trivyignore.yaml --show-suppressed` and retaining `timeout-minutes: 15`.

### Finding 2: Transaction Wrapper Swallows Falsy Callback Rejections

- **Root Cause:** `database.ts` checked callback failure using truthiness (`if (transactionError)`), causing falsy rejections (`undefined`, `null`, `false`, `0`, `NaN`, `''`) to be treated as successful commits while leaving the transaction unresolved or mismanaged.
- **Fix:**
  - Introduced explicit boolean discriminants: `callbackFailed: boolean`, `hasTransactionFailure: boolean`, and `transactionFailureValue: unknown`.
  - Explicitly tests and preserves falsy rejection values, triggers rollback on `callbackFailed === true`, and propagates exact rejections across both success and rollback/release error branches.

### Finding 3: Database Credentials Exposed in Error Message and Inconsistent Stack Redaction

- **Root Cause:** `scripts/infra-up.mjs` interpolated raw connection errors (`error.message`) into stdout during polling, which could expose raw database URLs or passwords. In `database.ts`, sanitized callback errors did not consistently scrub stack traces or `DatabaseError` causes.
- **Fix:**
  - Replaced raw error interpolation in `scripts/infra-up.mjs` with `classifyReadinessError()` using an allowlist of generic, credential-free classification strings (`connection_refused`, `authentication_failed`, `database_unavailable`, etc.).
  - Hardened `packages/infrastructure/src/database/errors.ts` (`stripCredentials`, `sanitizeCallbackError`) to deeply scrub passwords, connection strings, URI query parameters, and IPv6 host formats across `message`, `stack`, and causes.

### Finding 4: Insecure Fallback in Test Helper for NODE_ENV

- **Root Cause:** `packages/infrastructure/test/integration/helpers/setup.ts` contained `process.env.NODE_ENV ?? 'test'`, permitting unsafe defaults if `NODE_ENV` was undefined or whitespace.
- **Fix:**
  - Removed `?? 'test'` fallback; strictly requires `process.env.NODE_ENV === 'test'` and fails closed immediately.
  - Enforced exact match in `safety.ts` against `test` with explicit trim checks and sanitized error reporting without echoing untrusted values.

### Finding 5: Composition Root Ownership for API and Worker

- **Root Cause:** `apps/api/src/server.ts` and `apps/worker/src/runner.ts` instantiated database clients and loaded configuration independently when optional, violating single composition root architecture.
- **Fix:**
  - Required explicit `database: Database` injection in `startApiServer()` and `startWorker()`.
  - Removed internal database construction, config loading, and CA certificate reading from `server.ts` and `runner.ts`.
  - Centralized full dependency instantiation in composition roots: `apps/api/src/main.ts` and `apps/worker/src/main.ts`.

### Finding 6: Worker Shutdown Deadline Expiry Inadvertently Exits with Code 0

- **Root Cause:** In `apps/worker/src/runner.ts`, if abort was signaled, cleanup failures or deadline timeouts could be masked by the abort state, potentially resulting in exit code 0 rather than non-zero failure.
- **Fix:**
  - Reworked shutdown error handling so that if runtime shutdown, probe cleanup, or connection closure throws or times out, the process unconditionally invokes `terminate(1)`.

### Finding 7: README Misleadingly Claims Production Least Privilege for Local Development

- **Root Cause:** `README.md` stated that the local development database role followed least privilege, whereas `compose.yaml` used the bootstrap superuser role.
- **Fix:**
  - Corrected `README.md` to state that local Docker Compose environment reuses the bootstrap superuser for simplicity and rapid developer setup, while production deployments require separate unprivileged application roles.

---

## 2. Files Changed

### Added

- `.trivyignore.yaml`
- `plans/261024-0136-task-003-remediation-01/plan.md`
- `plans/reports/cook-261024-0325-task-003-remediation-01.md`
- `scripts/verify-trivy-exception.mjs`
- `security/exceptions/TASK-003-CVE-2025-68121-GOSU.md`
- `test/composition-roots.test.ts`

### Modified

- `.github/workflows/ci.yml`
- `README.md`
- `apps/api/src/server.ts`
- `apps/worker/src/runner.ts`
- `apps/worker/test/worker.test.ts`
- `package.json`
- `packages/infrastructure/src/database/database.ts`
- `packages/infrastructure/src/database/errors.ts`
- `packages/infrastructure/src/database/migrations/safety.ts`
- `packages/infrastructure/test/integration/database.integration.test.ts`
- `packages/infrastructure/test/integration/helpers/setup.ts`
- `packages/infrastructure/test/unit/database.unit.test.ts`
- `packages/infrastructure/test/unit/safety.unit.test.ts`
- `scripts/infra-up.mjs`
- `test/scripts.test.ts`

---

## 3. Regression Tests Added

1. **Finding 1 (Trivy Exception Policy & Verification):**
   - `test/scripts.test.ts`: Added unit tests verifying validation passes with valid ignore file, fails on missing file, expired date, mismatched CVE, modified path, extra entries, and CI workflow contract.
2. **Finding 2 (Falsy Transaction Rejections):**
   - `packages/infrastructure/test/unit/database.unit.test.ts`: Added unit tests verifying rejections with `undefined`, `null`, `false`, `0`, `NaN`, `''`, plus combined callback rejection + rollback/release failure.
   - `packages/infrastructure/test/integration/database.integration.test.ts`: Added real PostgreSQL integration tests verifying rollback on `undefined`, `false`, `0`, `''`, and that the connection pool remains healthy.
3. **Finding 3 (Credential Redaction):**
   - `test/scripts.test.ts`: Added unit tests verifying `classifyReadinessError()` maps unknown errors to safe generic labels and never leaks raw strings.
   - `packages/infrastructure/test/unit/database.unit.test.ts`: Added tests verifying credential sanitization in errors, cause chains, and stack traces.
4. **Finding 4 (Fail-Closed NODE_ENV Integration Guard):**
   - `packages/infrastructure/test/unit/safety.unit.test.ts`: Added unit tests verifying rejection of missing, empty, whitespace-only, and non-string `NODE_ENV`.
   - `packages/infrastructure/test/integration/database.integration.test.ts`: Added isolated child process test proving omitted `NODE_ENV` terminates with code 1 before creating database.
5. **Finding 5 (Composition Root Ownership):**
   - `test/composition-roots.test.ts`: Added behavioral unit tests asserting `startApiServer()` and `startWorker()` operate strictly on injected `Database` and configuration, ignoring poisoned `process.env`.
6. **Finding 6 (Worker Deadline Non-Zero Termination):**
   - `apps/worker/test/worker.test.ts`: Added tests verifying `terminate(1)` is invoked on startup probe timeout, pool close timeout during shutdown, pool close rejection, and zero remaining budget.
7. **Finding 7 (README Privilege Documentation):**
   - `test/scripts.test.ts`: Added regression test asserting `README.md` documents bootstrap superuser usage in local dev and distinguishes production least privilege.

---

## 4. Verification Commands and Real Results

| Command                                                          | Result         | Notes                                                                      |
| ---------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| `pnpm run verify:trivy-exception`                                | **Passed (0)** | Validated `.trivyignore.yaml` and doc schema                               |
| `pnpm run verify:infrastructure-pins`                            | **Passed (0)** | Pinned PostgreSQL digest verified on Docker Hub                            |
| `pnpm run format:check`                                          | **Passed (0)** | Prettier checked, all files match formatting                               |
| `pnpm run lint:boundaries`                                       | **Passed (0)** | 175 modules cruised, 0 violations                                          |
| `pnpm run lint`                                                  | **Passed (0)** | ESLint + depcruise passed with 0 errors                                    |
| `pnpm run typecheck`                                             | **Passed (0)** | TypeScript check passed for all 5 projects                                 |
| `pnpm run test`                                                  | **Passed (0)** | 15 test files, 208 tests passed                                            |
| `pnpm run build`                                                 | **Passed (0)** | Next.js and all package builds succeeded                                   |
| `pnpm run check`                                                 | **Passed (0)** | Full pipeline passed                                                       |
| `pnpm audit --prod --audit-level high`                           | **Passed (0)** | 0 high/critical vulnerabilities found                                      |
| `pnpm run infra:up`                                              | **Passed (0)** | PostgreSQL container started and healthy (5/5)                             |
| `pnpm run db:migrate`                                            | **Passed (0)** | Baseline migration confirmed up to date                                    |
| `pnpm run db:migrate:status`                                     | **Passed (0)** | 1 migration applied, 0 drift                                               |
| `pnpm run db:migrate:validate`                                   | **Passed (0)** | Validation passed against isolated test database                           |
| `pnpm run test:integration`                                      | **Passed (0)** | 2 test files, 19 integration tests passed                                  |
| `pnpm run infra:down`                                            | **Passed (0)** | PostgreSQL container stopped and removed cleanly                           |
| Trivy scan (with ignorefile & `--show-suppressed`)               | **Passed (0)** | Reported 0 vulnerabilities; exactly 1 suppressed (`CVE-2025-68121`)        |
| Trivy blocking check (`CRITICAL --ignore-unfixed --exit-code 1`) | **Passed (0)** | Code 0, clean scan                                                         |
| Trivy negative control (without ignorefile)                      | **Failed (1)** | As expected, flagged unsuppressed `CVE-2025-68121` on `usr/local/bin/gosu` |
