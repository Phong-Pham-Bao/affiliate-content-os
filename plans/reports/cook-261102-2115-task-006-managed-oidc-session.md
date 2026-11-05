# Cook Report: TASK-006 Managed OIDC and Application Session Management

Date: 2026-11-02
Task: `tasks/TASK-006.md`
Branch: `agy/task-006-managed-oidc-session`
Base: `origin/main` (`b5255f969c1b5729f8ed0135ca14b85b579c0599`)

---

## 1. Objective and Scope

Implemented provider-neutral managed OIDC authorization-code flow with PKCE S256, transaction binding, and PostgreSQL-backed opaque session management:

1. **Authentication Configuration (`packages/config`)**:
   - `AuthConfig` with strict URL parsing, 32-byte canonical base64url AES-GCM encryption key, key versioning (`^[A-Za-z0-9._-]{1,64}$`), strict TTL invariants, and production HTTPS/secure cookie enforcement.
   - `getRedactedAuthConfigMetadata` with total secret redaction.
2. **Schema Migration 0003 (`packages/infrastructure/migrations/0003_application_auth.sql`)**:
   - `oidc_login_transactions`: one-time login transactions with PKCE, state/nonce hashes, AES-GCM encrypted secrets, and browser binding.
   - `application_sessions`: opaque server-side sessions with sliding idle expiry, absolute expiry, token rotation, previous-token grace window, touch interval, and revocation tracking.
3. **Cryptographic Primitives (`packages/infrastructure/src/auth/crypto.ts`)**:
   - Native Node.js `crypto` primitives for CSPRNG random bytes, canonical unpadded base64url, SHA-256 hashing, and AES-256-GCM authenticated encryption with 12-byte IV and 16-byte tag.
4. **PostgreSQL Auth Adapters (`packages/infrastructure/src/auth`)**:
   - `PostgresLoginTransactionAdapter`: Atomic atomic CTE transaction creation and consume-and-scrub.
   - `PostgresSessionAdapter`: Atomic row-locking session lookup, rotation with grace window, touch interval, and logout revocation with token hash scrubbing.
   - `PostgresWorkspaceSummaryAdapter`: Query active user memberships and workspaces with stable ordering and `LIMIT 101` pagination detection.
5. **Application Contracts & Use Cases (`packages/application/src/auth`)**:
   - Finite safe public errors: `AuthConfigurationUnavailableError`, `AuthRequestValidationError`, `OidcCallbackInvalidError`, `OidcProviderUnavailableError`, `AuthenticationRequiredError`, `AuthPersistenceError`.
   - `beginOidcLogin`: validated `returnTo`, generated PKCE challenge, state, nonce, browser binding cookie secret, and stored transaction.
   - `completeOidcLogin`: validated callback query, atomic consume-and-scrub, decrypted secrets, OIDC authorization code exchange, TASK-005 verified identity resolution, active user status check, and session creation.
   - `authenticateApplicationSession`: token hashing, candidate lookup, rotation eligibility check, sliding expiry touch, and grace window handling.
   - `getCurrentUser`: safe authenticated user and active workspace summaries projection.
   - `logoutApplicationSession`: idempotent session token hash revocation.
6. **OIDC Protocol Adapter (`packages/infrastructure/src/auth/oidc-adapter.ts`)**:
   - Pinned `openid-client@6.8.8` wrapper supporting discovery, standard authorization URL generation, and code exchange with ID token validation.
7. **Fastify HTTP Layer (`apps/api`)**:
   - Pinned `@fastify/cookie@11.1.5` and `@fastify/rate-limit@11.2.1`.
   - `GET /auth/login` (rate limit: 30/min/IP).
   - `GET /auth/callback` (rate limit: 20/min/IP).
   - `GET /api/v1/me`.
   - `POST /api/v1/logout` with Origin validation.
   - Global RFC 9457 Problem Details error handler.
8. **OpenAPI 3.1 Contract (`openapi/openapi.json`) & Scripts**:
   - Executable OpenAPI 3.1 generator and verification script with Prettier formatting integration (`scripts/verify-openapi.mjs`).
   - Integrated `openapi:check` into root `check` pipeline.
9. **Documentation**:
   - Updated `docs/API.md`, `docs/DATABASE.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md`.

---

## 2. Pinned Dependencies Added

- `openid-client`: `6.8.8` (runtime, pinned in `packages/infrastructure`)
- `@fastify/cookie`: `11.1.5` (runtime, pinned in `apps/api`)
- `@fastify/rate-limit`: `11.2.1` (runtime, pinned in `apps/api`)
- `jose`: `6.2.12` (dev-only for loopback test OIDC issuer, pinned in `packages/infrastructure`)

---

## 3. Modularization Compliance

All source files in `packages/` and `apps/` created or modified for TASK-006 are strictly under 200 lines:

- `packages/config/src/validate-auth.ts`: 174 lines
- `packages/config/src/validate-auth-primitives.ts`: 189 lines
- `packages/config/src/redact.ts`: 56 lines
- `packages/config/src/types.ts`: 143 lines
- `packages/infrastructure/src/auth/postgres-session-adapter.ts`: 174 lines
- `packages/infrastructure/src/auth/postgres-session-statements.ts`: 65 lines
- `packages/infrastructure/src/auth/postgres-login-transaction-adapter.ts`: 124 lines
- `packages/infrastructure/src/auth/crypto.ts`: 122 lines
- `packages/infrastructure/src/auth/oidc-adapter.ts`: 176 lines
- `packages/infrastructure/src/auth/mappers.ts`: 127 lines
- `packages/application/src/auth/begin-oidc-login.ts`: 119 lines
- `packages/application/src/auth/complete-oidc-login.ts`: 145 lines
- `packages/application/src/auth/authenticate-session.ts`: 176 lines
- `packages/application/src/auth/get-current-user.ts`: 90 lines
- `packages/application/src/auth/logout-session.ts`: 65 lines
- `packages/application/src/auth/errors.ts`: 111 lines
- `packages/application/src/auth/ports.ts`: 154 lines
- `apps/api/src/auth/openapi-auth-paths.ts`: 170 lines
- `apps/api/src/auth/openapi-api-paths.ts`: 90 lines
- `apps/api/src/auth/schemas.ts`: 132 lines
- `apps/api/src/auth/callback-route.ts`: 129 lines
- `apps/api/src/auth/logout-route.ts`: 105 lines
- `apps/api/src/auth/login-route.ts`: 98 lines
- `apps/api/src/auth/me-route.ts`: 88 lines
- `apps/api/src/auth/cookies.ts`: 92 lines
- `apps/api/src/auth/origin.ts`: 52 lines
- `apps/api/src/auth/problem-details.ts`: 86 lines
- `apps/api/src/auth/routes.ts`: 82 lines

---

## 4. Verification Results

| Quality Gate              | Command                                         | Status | Result Details                                      |
| ------------------------- | ----------------------------------------------- | ------ | --------------------------------------------------- |
| Pnpm Frozen Lockfile      | `corepack pnpm install --frozen-lockfile`       | PASSED | Resolution skipped; lockfile up to date             |
| Local Environment         | `corepack pnpm env:local`                       | PASSED | Environment verified                                |
| Compose Configuration     | `docker compose config --quiet`                 | PASSED | Multi-container config verified                     |
| Infrastructure Pins       | `corepack pnpm verify:infrastructure-pins`      | PASSED | PostgreSQL 18.6 multi-arch digest verified          |
| Migration Engine          | `corepack pnpm db:migrate:validate`             | PASSED | 3 applied, second run 0 (no-op), clean teardown     |
| Integration Suite         | `corepack pnpm test:integration`                | PASSED | 9 test files, 98/98 tests passed (11.98s)           |
| Prettier Code Style       | `corepack pnpm format:check`                    | PASSED | All matched files use Prettier code style           |
| Boundary Architecture     | `corepack pnpm lint:boundaries`                 | PASSED | 378 modules, 877 dependencies cruised, 0 violations |
| ESLint Rules              | `corepack pnpm lint`                            | PASSED | 0 errors, 0 warnings                                |
| TypeScript Compiler       | `corepack pnpm typecheck`                       | PASSED | All 7 workspace packages typecheck cleanly          |
| Unit Test Suite           | `corepack pnpm test`                            | PASSED | 41 test files, 858/858 tests passed (26.81s)        |
| OpenAPI Specification     | `corepack pnpm openapi:check`                   | PASSED | `openapi/openapi.json` matches runtime schemas      |
| Production Build          | `corepack pnpm build`                           | PASSED | All 7 workspace packages and Next.js built cleanly  |
| Unified Check Pipeline    | `corepack pnpm check`                           | PASSED | Exit code 0 across entire aggregate check           |
| Production Audit          | `corepack pnpm audit --prod --audit-level high` | PASSED | 0 high or critical vulnerabilities                  |
| Security Exception Policy | `corepack pnpm verify:trivy-exception`          | PASSED | Valid exception `TASK-003-CVE-2025-68121-GOSU`      |
| Trivy Pinned Image Scan   | `trivy image --severity CRITICAL ...`           | PASSED | 0 unfixed critical vulnerabilities                  |
| Clean-Checkout Isolation  | Cloned branch into fresh temp directory         | PASSED | `install`, `check`, `test:integration` all exit 0   |
| Git Diff Hygiene          | `git diff --check origin/main...HEAD`           | PASSED | 0 whitespace or formatting issues                   |
