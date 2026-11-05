# Implementation Progress Report: Remediate Codex Findings for TASK-006

- **Task**: Remediate Codex Findings for TASK-006
- **Branch**: `agy/task-006-managed-oidc-session`
- **Initial SHA**: `eb0e17a42513ee15b09aeb68ec3841f86219b045`
- **Status**: Completed

---

## 1. Remediation Summary by Finding

### Finding 1: Production OIDC login cannot complete (CRITICAL)

- **Root Cause**: `apps/api/src/auth/login-route.ts` and `callback-route.ts` had fallback `crypto.randomUUID()` (UUIDv4) when `deps.generateId` was missing. Production composition in `apps/api/src/main.ts` instantiated `DefaultIdGenerator` but did not supply `generateId` into `authProvider`. The persistence mapper strictly checks `isValidUuidV7(row.id)` and rejected the resulting UUIDv4 transaction and session IDs after database write.
- **Fix**:
  - Added `generateId(): string` calling `generateUuidV7()` to `DefaultIdGenerator` and `IdGeneratorPort` in `packages/application/src/id-generator.ts` and `ports.ts`.
  - Wired `generateId: () => idGenerator.generateId()` in `apps/api/src/main.ts`.
  - Removed all `randomUUID()` fallbacks in `login-route.ts` and `callback-route.ts`; routes require `deps.generateId` and fail fast with `AuthConfigurationUnavailableError` (503) if absent.
  - Verified in `oidc-session-flow.integration.test.ts` with real PostgreSQL and test OIDC issuer: `oidc_login_transactions.id`, `application_sessions.id`, and `users.id` all validate with `isValidUuidV7(id) === true`.

### Finding 2: Session rotation is not atomic across authentication (HIGH)

- **Root Cause**: `SELECT ... FOR UPDATE` was executed in an autocommit query, immediately releasing row locks before session rotation was decided or executed. `authenticateApplicationSession` did not use `withTransaction`. Concurrent current-token requests reading version 1 resulted in one winning while the other threw `DatabaseError: Session rotation concurrency conflict`.
- **Fix**:
  - Refactored `SessionStorePort.withTransaction<T>` to pass transactional store `(fn: (txStore: SessionStorePort) => Promise<T>): Promise<T>`.
  - Implemented `createAdapterForRunner` in `packages/infrastructure/src/auth/postgres-session-adapter.ts` so `withTransaction` passes `txStore` scoped to the PostgreSQL transaction.
  - Wrapped candidate query, expiry checks, rotation, and touching inside `deps.sessionStore.withTransaction(async (txStore) => ...)`.
  - Concurrent requests now serialize row locks: the waiter re-evaluates the committed row (version 2), matches `previousTokenHash` within grace window, and authenticates cleanly without error.
  - Added adversarial tests in `packages/infrastructure/test/integration/session-concurrency.integration.test.ts` verifying that concurrent requests serialize cleanly (one rotates, one authenticates via grace, zero conflicts) and forced schedules in both orders authenticate successfully.

### Finding 3: Hostile values execute getters and escape safe boundaries (HIGH)

- **Root Cause**: Property reads and type assertions across mappers, callback query parsing, and problem-details mapping invoked arbitrary property getters and prototype traps.
- **Fix**:
  - Modularized mappers in `packages/infrastructure/src/auth/` (`mapper-helpers.ts`, `transaction-mapper.ts`, `session-mapper.ts`, `workspace-summary-mapper.ts`).
  - Added strict `isProxySafe`, `Object.getOwnPropertyDescriptor` inspection, genuine Uint8Array copies via `copyBytes`, and rejected hostile prototype getters.
  - Refactored `resolveProblemSpec` in `apps/api/src/auth/problem-details.ts` to check `util.types.isProxy(error)` and inspect descriptors for `code` and `statusCode` without invoking traps.
  - Verified across 7 adversarial test cases in `apps/api/test/auth-adversarial-hostile.unit.test.ts`.

### Finding 4: Callback validation order can consume an invalid callback (HIGH)

- **Root Cause**: Fastify schema validation stripped unknown query parameters (`removeAdditional: true`) and converted repeated keys into arrays before route handler execution.
- **Fix**:
  - Added a `preValidation` hook to `/auth/callback` in `apps/api/src/auth/callback-route.ts` that inspects raw URL search parameters before Fastify strips or coerces them.
  - Rejects unrecognized parameters and duplicate query keys immediately by throwing `OidcCallbackInvalidError` (400 `OIDC_CALLBACK_INVALID`).
  - Guarantees zero crypto, persistence, or provider calls on malformed, duplicate, or unexpected callback queries.
  - Verified in `apps/api/test/auth-callback-route.unit.test.ts`.

### Finding 5: Logout reports success when revocation fails (HIGH)

- **Root Cause**: `apps/api/src/auth/logout-route.ts` swallowed all persistence errors in a generic `try/catch` block and returned 204.
- **Fix**:
  - Removed error swallowing in `logout-route.ts`. Valid logout remains idempotent, while ambiguous database mutations propagate to the central problem handler returning a safe 500 Problem Details (`INTERNAL_ERROR`).
  - Verified in `apps/api/test/auth-logout-route.unit.test.ts`.

### Finding 6: Runtime response and OpenAPI disagree on workspace roles (HIGH)

- **Root Cause**: Runtime schema declared `['owner', 'admin', 'member']` while system specification required `['owner', 'editor', 'viewer']`.
- **Fix**:
  - Updated role enum in `apps/api/src/auth/schemas.ts` and `workspace-summary-mapper.ts` to `['owner', 'editor', 'viewer']`.
  - Regenerated `openapi/openapi.json` via `pnpm openapi:generate` and verified with `pnpm openapi:check`.

### Finding 7: Session database constraints do not enforce the approved timestamp invariants (HIGH)

- **Root Cause**: Migration `0003_application_auth.sql` checked `idle_expires_at >= created_at` instead of `idle_expires_at >= last_seen_at`, allowing malformed session timelines to be persisted.
- **Fix**:
  - Updated `application_sessions_timestamps_order_check` in `packages/infrastructure/migrations/0003_application_auth.sql`:
    `last_seen_at >= created_at AND rotated_at >= created_at AND last_seen_at >= rotated_at AND idle_expires_at >= last_seen_at AND absolute_expires_at > created_at AND idle_expires_at <= absolute_expires_at`.
  - Validated migration checksums and idempotency via `pnpm db:migrate:validate`.
  - Added test cases in `packages/infrastructure/test/integration/auth-schema.integration.test.ts` proving PostgreSQL rejects violations of `last_seen_at > idle_expires_at`, `rotated_at > last_seen_at`, `created_at > rotated_at`, and `idle_expires_at > absolute_expires_at`.

### Finding 8: Startup probe and discovery lifecycle violates single-close ownership (HIGH)

- **Root Cause**: `apps/api/src/main.ts` called `database.close()` in its catch block after `startApiServer` had already closed the database pool during Phase 0 failure, causing double-close. Additionally, discovery was not cancellable via `AbortSignal`.
- **Fix**:
  - Removed redundant `database.close()` from `main.ts`; `startApiServer` owns the database pool lifecycle exclusively once passed in.
  - Updated `discoverOidcAdapter` in `packages/infrastructure/src/auth/oidc-adapter.ts` to accept `{ signal?: AbortSignal }` and pass custom fetch with abort signal.
  - Updated `startApiServer` to pass `startupAbortController.signal` to `auth` provider factory in Phase 0.
  - Verified in `apps/api/test/app.test.ts` that failure or SIGINT cancels in-flight discovery, terminates cleanly with exact exit codes, and closes `database.close()` exactly once.

### Finding 9: Test OIDC issuer is permissive and accepts invalid OIDC protocol operations (HIGH)

- **Root Cause**: `packages/infrastructure/test/helpers/test-oidc-issuer.ts` did not enforce client authentication, did not validate PKCE S256 verifiers, did not track authorization codes or prevent replay, and did not validate redirect URIs.
- **Fix**:
  - Hardened `test-oidc-issuer.ts` to strictly require Basic client authentication (`401 invalid_client`), validate `grant_type === 'authorization_code'` (`400 unsupported_grant_type`), validate authorization codes with single-use replay prevention (`400 invalid_grant`), validate matching redirect URI (`400 invalid_grant`), and verify PKCE S256 code challenge against verifier (`400 invalid_grant`).
  - Added `issueCode` helper to register valid challenge/nonce/redirect parameters.
  - Added comprehensive protocol violation integration tests in `packages/infrastructure/test/integration/oidc-session-lifecycle.integration.test.ts` testing all 9 protocol criteria.

---

## 2. Quality Gates Status

| Quality Gate          | Command                           | Result                                                                             |
| --------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| Code Formatting       | `pnpm format:check`               | Passed (All files match Prettier style)                                            |
| Linter & Boundaries   | `pnpm lint`                       | Passed (0 ESLint errors, 384 modules / 907 dependencies cruised with 0 violations) |
| TypeScript Types      | `pnpm typecheck`                  | Passed (0 errors across 7 workspace projects)                                      |
| Unit Tests            | `pnpm test`                       | Passed (871 tests passed across 42 test files)                                     |
| Integration Tests     | `pnpm test:integration`           | Passed (102 tests passed across 10 test files on real PostgreSQL + local OIDC)     |
| OpenAPI Schema        | `pnpm openapi:check`              | Passed (`openapi/openapi.json` matches runtime schemas)                            |
| Infrastructure Pins   | `pnpm verify:infrastructure-pins` | Passed (`postgres:18.6-bookworm@sha256:bbf8...` verified)                          |
| Security Exceptions   | `pnpm verify:trivy-exception`     | Passed (`TASK-003-CVE-2025-68121-GOSU` policy verified)                            |
| Migration Validation  | `pnpm db:migrate:validate`        | Passed (3 applied, 0 no-op, 3 checksums verified)                                  |
| Full Repository Check | `pnpm check`                      | Passed (Exit code 0)                                                               |
| Git Whitespace Check  | `git diff --check`                | Passed (Exit code 0, 0 whitespace errors)                                          |
