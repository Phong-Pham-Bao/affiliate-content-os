# Implementation Report: Remediate TASK-006 Codex Review Findings

- **Date**: 2026-11-04
- **Branch**: `agy/task-006-managed-oidc-session`
- **Target Task**: TASK-006 (Managed OIDC and Session Authentication)
- **Status**: Complete & Verified

---

## 1. Finding 1 (HIGH) — Session Auth Self-Starvation with `DATABASE_POOL_MAX=1`

### Root Cause
Session candidate locking occurred inside `withTransaction`, holding the sole connection in single-connection pool configurations (`poolMax=1`). The subsequent user lookup called the root `deps.userDirectory` adapter, which attempted to acquire a second connection from the exhausted pool, causing query timeout and self-starvation.

### Implementation
- Added transaction-scoped `findUserById(userId: string)` to `SessionStorePort` (`packages/application/src/auth/ports.ts`).
- Modularized interfaces into `packages/infrastructure/src/auth/postgres-session-types.ts` (65 lines).
- Implemented `findUserById` in `packages/infrastructure/src/auth/postgres-session-adapter.ts` (197 lines) using `runner.query` on the existing transactional client (`FIND_USER_BY_ID_SQL`, `LIMIT 2`, safe descriptor inspection, zero proxy traps).
- Updated `authenticateApplicationSession` (`packages/application/src/auth/authenticate-session.ts`, 165 lines) to query `store.findUserById(parsedUserId)` via the active transaction runner before fallback.
- Added comprehensive integration test in `packages/infrastructure/test/integration/session-concurrency.integration.test.ts` running against real PostgreSQL with `poolMax: 1` covering authentication, touch, rotation, inactive user revocation, and concurrent token exchanges.

---

## 2. Finding 2 (HIGH) — Hostile Values & Proxies Executing Traps / Getters

### Root Cause
Unsafe property lookups, premature `instanceof` / prototype inspections, and unvalidated descriptor access in:
1. `apps/api/src/auth/problem-details.ts`
2. `packages/application/src/auth/authenticate-session.ts`
3. `packages/application/src/auth/complete-oidc-login.ts`
4. `packages/application/src/auth/get-current-user.ts`
5. `packages/infrastructure/src/auth/postgres-login-transaction-adapter.ts`
6. `packages/infrastructure/src/auth/postgres-workspace-summary-adapter.ts`

### Implementation
- **Problem Details** (`apps/api/src/auth/problem-details.ts`, 177 lines, specs modularized in `apps/api/src/auth/problem-details-specs.ts`, 77 lines): `util.types.isProxy` check runs first. Prototype chain proxy checks execute *before* any `instanceof` check or property access. Hostile traps map to safe fresh `INTERNAL_ERROR` (HTTP 500) without sentinel leakage.
- **Candidate Session Snapshotting** (`packages/application/src/auth/authenticate-session-candidate.ts`, 149 lines): Strict inspection of own data descriptors (`Object.getOwnPropertyDescriptor(raw, prop)` checking `desc.get === undefined && desc.set === undefined`), defensive copy of byte arrays (`copyBytes`), prototype verification (`proto === Object.prototype || proto === null`).
- **OIDC Completion Snapshots** (`packages/application/src/auth/complete-oidc-login-snapshots.ts`, 194 lines): Snapshots consumed transaction DTO (`snapshotConsumedTx`), verified claims (`snapshotVerifiedClaims`), and decrypted secrets (`snapshotSecrets`) with own data descriptors and byte cloning.
- **Current User Resolution** (`packages/application/src/auth/get-current-user.ts`, 139 lines): Validates and snapshots `context.user`, `context.session`, and `deps.workspaceSummary` array items via own data descriptors before access.
- **Postgres Adapters** (`postgres-login-transaction-adapter.ts`, 198 lines; `postgres-workspace-summary-adapter.ts`, 76 lines): Verifies `result.rows` array prototype, descriptors, non-proxy nature, and own data properties.
- **Adversarial Unit Tests** (`apps/api/test/auth-adversarial-hostile-proxies.unit.test.ts`, 199 lines): Verifies proxy traps, throwing getters on `revokedAt`, `returnTo`, and workspace summaries trigger 0 trap calls and expose 0 sentinels.

---

## 3. Finding 3 (HIGH) — Malformed Callback Encoding Consuming Login Transaction

### Root Cause
`new URL(..., dummyBase).searchParams` leniently accepted invalid percent encodings (such as `%` or incomplete hex sequences) as raw strings. The pre-validation check did not inspect raw percent triplets before `completeOidcLogin` ran, prematurely consuming the pending transaction in the database.

### Implementation
- Added raw query grammar and percent triplet validation in `apps/api/src/auth/callback-route.ts` (187 lines):
  - Validates raw query string matching `^[A-Za-z0-9_.~%!$&'()*+,;=:@/?-]*$`.
  - Checks every `%` is followed by two valid hex digits `[0-9A-Fa-f]{2}`.
  - Verifies UTF-8 byte sequences decode without replacement character `\uFFFD`.
  - Rejects unknown query keys (allowed: `code`, `state`, `error`, `error_description`, `error_uri`).
  - Rejects duplicate and encoded-duplicate keys.
  - Attached route-level `onRequest` hook to clear transaction cookie across all outcomes.
- Unit tests (`apps/api/test/auth-callback-route.unit.test.ts`): Proves `GET /auth/callback?code=%&state=s` returns 400 `OIDC_CALLBACK_INVALID` with zero transaction consumption calls.

---

## 4. Finding 4 (MEDIUM) — `returnTo` Canonical Path Contract Hardening

### Root Cause
`validateReturnTo` lacked checks for fragments (`#`), encoded path separators (`%2f`, `%5c`), double encoding (`%25`), and `/auth/login` did not reject duplicate `returnTo` query keys or malformed percent triplets in raw query targets.

### Implementation
- Hardened `validateReturnTo` (`packages/application/src/auth/begin-oidc-login.ts`, 168 lines):
  - Rejects hash fragments (`#`).
  - Rejects encoded slashes/backslashes (`%2f`, `%5c`, `%2F`, `%5C`, `%25`).
  - Rejects encoded control characters (`%00` through `%1f`, `%7f` through `%9f`).
  - Enforces decode idempotence (`decodeURIComponent(target) === target` for safe characters).
  - Rejects Unicode lookalikes and multi-slash path starts (`/\\`, `//`).
- Hardened `apps/api/src/auth/login-route.ts` (129 lines):
  - Validates raw query targets and percent triplets.
  - Rejects repeated/duplicate `returnTo` query parameters with 400 `OIDC_CALLBACK_INVALID`.
  - Rejects unknown query keys.
- Comprehensive unit tests in `packages/application/test/auth/begin-oidc-login.unit.test.ts` and `apps/api/test/auth-login-route.unit.test.ts`.

---

## 5. Finding 5 (MEDIUM) — Boundary & Upgrade Test Coverage

### Root Cause
Missing real PostgreSQL tests for TASK-005 to TASK-006 schema upgrade, timestamp equality boundaries, forced concurrent current/previous order schedules, and exact grace boundary checks.

### Implementation
- **Schema Upgrade Test** (`packages/infrastructure/test/integration/auth-schema.integration.test.ts`):
  - Creates isolated test database, applies migrations 0001 and 0002 (TASK-005 schema).
  - Seeds tenant, workspace, user, and membership rows.
  - Runs migration 0003 (TASK-006 upgrade).
  - Asserts all pre-existing data is preserved and auth tables (`auth_sessions`, `auth_login_transactions`) are functional.
- **Permitted Timestamp Equality Boundaries** (`auth-schema.integration.test.ts`):
  - Proves valid equality boundaries: `rotated_at = last_seen_at`, `rotated_at = created_at`, `idle_expires_at = absolute_expires_at`.
- **Forced Concurrency & Grace Boundaries** (`packages/infrastructure/test/integration/session-concurrency.integration.test.ts`):
  - Schedule A (current token commits first, previous token concurrent).
  - Schedule B (previous token commits first, current token concurrent).
  - Exact grace expiry tests: request at `T < graceValidUntil` succeeds; request at `T = graceValidUntil` / `T > graceValidUntil` fails cleanly.

---

## 6. Verification & Quality Gates

All quality gates executed and passing:
1. `corepack pnpm format:check`: Passed (all files conform to Prettier).
2. `corepack pnpm lint`: Passed (0 ESLint errors).
3. `corepack pnpm lint:boundaries`: Passed (0 dependency boundary violations across 411 modules).
4. `corepack pnpm typecheck`: Passed (0 TypeScript errors across 7 workspace projects).
5. `corepack pnpm test`: Passed (879 unit tests passed across 43 test files).
6. `corepack pnpm test:integration`: Passed (105 real PostgreSQL integration tests passed across 10 test files).
7. `corepack pnpm openapi:check`: Passed (`openapi/openapi.json` matches runtime schemas).
8. `corepack pnpm build`: Passed (all packages & Next.js production web build succeeded).
9. `corepack pnpm check`: Passed (aggregate pipeline green).
10. `corepack pnpm verify:infrastructure-pins`: Passed (postgres pinned to digest `sha256:bbf835...`).
11. `corepack pnpm verify:trivy-exception`: Passed (exception verified).
12. `corepack pnpm db:migrate:validate`: Passed (3 applied, 0 drift, checksums verified).
13. `corepack pnpm audit --prod --audit-level=high`: Passed (0 high/critical vulnerabilities).
14. File size limits: All 18 touched source files verified strictly <200 lines.

---

## 7. Unresolved Questions

None. All 5 review findings have been resolved with full test coverage and verified quality gates.
