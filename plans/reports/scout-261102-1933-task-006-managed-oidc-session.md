# Scout Report: TASK-006 Managed OIDC Login, Server Sessions, and Current-User Boundary

Date: 2026-11-02
Task: `tasks/TASK-006.md`
Base: `origin/main` (`b5255f969c1b5729f8ed0135ca14b85b579c0599`)
Branch: `agy/task-006-managed-oidc-session`

## 1. Codebase Preflight Status

- Local `main` SHA: `b5255f969c1b5729f8ed0135ca14b85b579c0599`
- `origin/main` SHA: `b5255f969c1b5729f8ed0135ca14b85b579c0599`
- Working tree clean: Yes
- Node version: `v24.14.0`
- pnpm version: `12.4.2`
- Docker engine: `29.7.2` (running via WSL2, container `acos_postgres` healthy)
- Docker compose: `v5.5.1`
- Approved dependencies:
  - `openid-client`: `6.8.8` (runtime in `@affiliate-content-os/infrastructure`)
  - `@fastify/cookie`: `11.1.5` (runtime in `apps/api`)
  - `@fastify/rate-limit`: `11.2.1` (runtime in `apps/api`)
  - `jose`: `6.2.12` (dev dependency for test-only loopback OIDC issuer)

## 2. Inspected Modules

- `packages/config`: `validate.ts`, `validate-api.ts`, `validate-database.ts`, `redact.ts`, `types.ts`, `errors.ts`
- `packages/domain`: `identity.ts`, `ids.ts`, `timestamps.ts`, `types.ts`, `errors.ts`
- `packages/application`: `resolve-verified-identity.ts`, `ports.ts`, `errors.ts`, `clock.ts`, `id-generator.ts`
- `packages/infrastructure`:
  - `src/database`: connection pool, transaction runner, migration CLI/engine
  - `src/tenancy`: `mappers.ts`, `postgres-tenancy-adapter.ts`
- `apps/api`: `app.ts`, `server.ts`, `main.ts`, `timeout.ts`
- Architecture & Boundaries: `.dependency-cruiser.js`, `eslint.config.mjs`, `tsconfig.base.json`

## 3. Discovered Specification Conflicts or Blockers

- Zero specification conflicts discovered.
- Standards-based provider-neutral OIDC is specified; no vendor SDK or vendor claims required.
- Local loopback OIDC test issuer with `jose` dev dependency will provide deterministic contract testing.

## 4. Expected Production Files

- `packages/config/src/validate-auth.ts`: `loadAuthConfig` validation implementation
- `packages/config/src/types.ts`: `AuthConfig`, `RedactedAuthConfigMetadata` types
- `packages/config/src/redact.ts`: `getRedactedAuthConfigMetadata` helper
- `packages/config/src/index.ts`: export auth config surface
- `packages/infrastructure/migrations/0003_application_auth.sql`: migration adding `oidc_login_transactions` and `application_sessions`
- `packages/infrastructure/src/auth/*`:
  - `crypto.ts`: AES-256-GCM, SHA-256, secure random bytes
  - `oidc-adapter.ts`: openid-client protocol adapter
  - `postgres-login-transaction-adapter.ts`: atomic login transaction store
  - `postgres-session-adapter.ts`: atomic session lifecycle store
  - `postgres-workspace-summary-adapter.ts`: bounded active workspace query
  - `types.ts`: internal SQL row shapes and safe mappers
  - `index.ts`: public `./auth` package export
- `packages/application/src/auth/*`:
  - `ports.ts`: auth ports (transaction, session, crypto, OIDC, workspace summary)
  - `errors.ts`: finite safe error classes (`AuthConfigurationUnavailableError`, `AuthRequestValidationError`, etc.)
  - `begin-oidc-login.ts`: `beginOidcLogin` use case
  - `complete-oidc-login.ts`: `completeOidcLogin` use case
  - `authenticate-session.ts`: `authenticateApplicationSession` use case
  - `get-current-user.ts`: `getCurrentUser` use case
  - `logout-session.ts`: `logoutApplicationSession` use case
  - `index.ts`: public auth use cases and types
- `apps/api/src/auth/*`:
  - `cookies.ts`: cookie serialization, parsing, clear attributes
  - `routes.ts`: `/auth/login`, `/auth/callback`, `/api/v1/me`, `/api/v1/logout`
  - `schemas.ts`: Fastify route schemas
  - `problem-details.ts`: RFC 9457 Problem Details error handler
- `apps/api/src/app.ts`: compose auth plugins and routes
- `apps/api/src/main.ts`: wire concrete configuration and OIDC discovery
- `apps/api/src/server.ts`: bounded shutdown lifecycle
- `openapi/openapi.json`: OpenAPI 3.1 specification
- `scripts/verify-openapi.mjs`: deterministic OpenAPI drift check
