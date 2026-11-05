# Research Report: TASK-006 Findings Remediation Analysis

## 1. Finding 1: UUIDv7 Production Wiring

- `main.ts` instantiated `DefaultIdGenerator` but omitted `generateId` and `now` from `authDeps`.
- Routes defaulted to `crypto.randomUUID()` (UUIDv4). `mappers.ts` requires `isValidUuidV7(id)`.
- Solution: Inject `generateId: () => idGenerator.generateId()` and `now: () => clock.now()` in `main.ts`. In `login-route.ts` and `callback-route.ts`, require `generateId` and `now` or fail closed (no UUIDv4 fallback). Persisted IDs must be validated as UUIDv7.

## 2. Finding 2: Atomic Session Rotation Concurrency

- `findCandidateSessions` executes `SELECT ... FOR UPDATE` in autocommit outside `withTransaction()`.
- Solution: Wrap session read, expiry/user checks, and rotate/touch/revoke inside `deps.sessionStore.withTransaction()`. Pass `txStore: SessionStorePort` to callback.
- In PostgreSQL read-committed mode, concurrent `FOR UPDATE` serializes: the second query re-evaluates the committed rotated row, matching `previous_token_hash` within grace. It evaluates to previous token, does not rotate, and authenticates.

## 3. Finding 3: Hostile Accessors & Error Mappings

- `problem-details.ts` read `(error as any)?.code` and `.statusCode`, invoking hostile getters.
- `mappers.ts` read `row['id']` and used `instanceof Uint8Array`.
- `complete-oidc-login.ts` used `Object.keys` and direct property indexing.
- Solution: Apply TASK-005 proxy check (`isProxySafe`), descriptor inspection (`Object.getOwnPropertyDescriptor`), own-keys verification, prototype checks, and defensive byte copying. For error mapping, inspect known error classes (`instanceof KnownError`) first; for unknown errors, never inspect arbitrary `.code` or `.statusCode` getters directly without descriptor safety.

## 4. Finding 4: Callback Query Validation Order

- Fastify removes unknown query parameters when schema validation runs.
- Solution: Validate the raw query parameters from the request URL before any parsing, hashing, or persistence calls. Enforce exact key count, no duplicate keys, allowed keys only (`code` + `state` or `error` + `state` + optional `error_description` + `error_uri`). Zero calls to crypto/persistence on invalid query.

## 5. Finding 5: Logout Error Propagation

- `logout-route.ts` caught all errors and returned 204.
- Solution: Missing/malformed/expired cookies remain idempotent (return 204 without database error). When `sessionStore.revokeMatchingSessionsByTokenHash()` throws a persistence/database error, let it propagate so the error handler returns 500 Problem Details.

## 6. Finding 6: Workspace Roles Enum

- `schemas.ts` had `role: { enum: ['owner', 'admin', 'member'] }`.
- Solution: Update enum to `['owner', 'editor', 'viewer']` matching domain/application contracts. Run `pnpm openapi:generate`.

## 7. Finding 7: Session Timestamp Database Constraints

- Migration 0003 checked `idle_expires_at >= created_at`.
- Solution: Update `0003_application_auth.sql` constraint to `idle_expires_at >= last_seen_at AND last_seen_at >= rotated_at AND rotated_at >= created_at AND idle_expires_at <= absolute_expires_at AND absolute_expires_at > created_at`. Add corresponding validation in `mapSessionRow`.

## 8. Finding 8: Startup/Discovery Ownership & Cancellation

- `discoverOidcAdapter()` ignored `AbortSignal`.
- Signal handlers were installed inside `startApiServer()` after discovery in `main.ts`.
- `startApiServer()` closed database on failure, and `main.ts` closed it again.
- Solution: Provide cancellation signal to discovery (via customFetch/race). Establish single owner for database and discovery lifecycle. Ensure each resource is closed exactly once.

## 9. Finding 9: Strict Test OIDC Issuer & Integration Matrix

- `test-oidc-issuer.ts` skipped client auth validation if missing, and skipped code/redirect_uri/PKCE checks.
- Solution: Require Basic auth matching client credentials; validate code, redirect URI, and PKCE challenge (S256). Expand integration suites with production composition, concurrency matrix, and edge cases.
