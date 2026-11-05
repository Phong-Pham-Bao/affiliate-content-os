# Scout Report: TASK-006 Codex Findings Remediation

- **Task**: Remediate all 9 Codex review findings for TASK-006
- **Branch**: `agy/task-006-managed-oidc-session`
- **Reviewed Commit**: `eb0e17a42513ee15b09aeb68ec3841f86219b045`
- **Status**: Changes Required

## Findings Summary & File Map

1. **Production OIDC login cannot complete (CRITICAL)**:
   - `apps/api/src/main.ts`: DefaultIdGenerator instantiated but not passed in `authDeps` (`generateId`).
   - `apps/api/src/auth/login-route.ts`, `apps/api/src/auth/callback-route.ts`: Fallback to `randomUUID()` (UUIDv4).
   - `packages/domain/src/ids.ts`: Provide/use UUIDv7 generation.
   - `packages/infrastructure/src/auth/mappers.ts`: Validates UUIDv7; rejects UUIDv4.

2. **Session rotation is not atomic across authentication (HIGH)**:
   - `packages/application/src/auth/authenticate-session.ts`: `findCandidateSessions` and subsequent mutations run outside `withTransaction()`.
   - `packages/application/src/auth/ports.ts`: `SessionStorePort.withTransaction` signature and transactional store scoping.
   - `packages/infrastructure/src/auth/postgres-session-adapter.ts`: Transaction-scoped queries.

3. **Hostile values execute getters and escape safe boundaries (HIGH)**:
   - `packages/application/src/auth/complete-oidc-login.ts`: Direct property access on query.
   - `packages/application/src/auth/authenticate-session.ts`: Candidates and snapshot validation.
   - `packages/infrastructure/src/auth/mappers.ts`: `rawRow` direct indexing, `instanceof` on byte buffers.
   - `apps/api/src/auth/problem-details.ts`: Direct `.code` and `.statusCode` access on unknown error objects.

4. **Callback validation order can consume an invalid callback (HIGH)**:
   - `apps/api/src/auth/schemas.ts`: `additionalProperties: false` with Fastify's query stripper.
   - `apps/api/src/auth/callback-route.ts`: Validate raw query multiplicity and key set before any crypto or persistence.
   - `packages/application/src/auth/complete-oidc-login.ts`: Fail closed before hashing state/binding.

5. **Logout reports success when revocation fails (HIGH)**:
   - `apps/api/src/auth/logout-route.ts`: Swallows all persistence errors in try/catch. Propagate database errors to 500 Problem Details.

6. **Runtime response and OpenAPI disagree on workspace roles (HIGH)**:
   - `apps/api/src/auth/schemas.ts`: Enum was `['owner', 'admin', 'member']`. Change to `['owner', 'editor', 'viewer']`.
   - `openapi/openapi.json`: Regenerate OpenAPI artifact.

7. **Session database constraints do not enforce the approved timestamp invariants (HIGH)**:
   - `packages/infrastructure/migrations/0003_application_auth.sql`: Strengthen constraints (`idle_expires_at >= last_seen_at`, `last_seen_at >= rotated_at`).
   - `packages/infrastructure/src/auth/mappers.ts`: Validate timestamp relations.

8. **Startup/discovery ownership and cancellation are incomplete (MEDIUM)**:
   - `packages/infrastructure/src/auth/oidc-adapter.ts`: Discovery ignores `AbortSignal`.
   - `apps/api/src/main.ts`, `apps/api/src/server.ts`: Move discovery/auth setup under single lifecycle owner and signal handling. Never close database twice.

9. **The local OIDC integration harness does not prove the required protocol (HIGH)**:
   - `packages/infrastructure/test/helpers/test-oidc-issuer.ts`: Enforce strict client auth, redirect URI, code, PKCE validation.
   - Integration test suites: Production composition, concurrency matrix, and edge case tests.
