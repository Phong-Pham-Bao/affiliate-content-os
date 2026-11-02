# Cook Report: TASK-005 Verified OIDC Identity Provisioning Boundary

Date: 2026-11-01
Task: `tasks/TASK-005.md`
Branch: `agy/task-005-verified-identity`
Base: `origin/main` (`f8a39fe`)

---

## 1. Objective and Architectural Context

Implemented the provider-neutral application identity slice following TASK-004:

1. Accept narrowly shaped, validated `VerifiedIdentityClaims` DTO from authentication adapters.
2. Resolve application users by exact `(identity_provider, identity_subject)` lookup key.
3. Provision one active application user with version 1, equal canonical ISO timestamps, and generated UUIDv7 ID when the key is new.
4. Return an immutable, safe `ApplicationPrincipal` (`kind: 'verified_oidc'`).
5. Guarantee atomic concurrency race recovery with zero duplicates via `ON CONFLICT (identity_provider, identity_subject) DO NOTHING RETURNING ...` followed by one fresh recovery lookup.
6. Fail closed on disabled or deletion-pending identities with safe non-disclosing `IdentityUnavailableError`.
7. Reject multiple users in lookup or recovery with `IdentityPersistenceError`.
8. Enforce total credential and metadata non-disclosure: no input values, raw driver errors, SQL, or tokens reach error messages, logs, or serialization.

---

## 2. Implementation Summary by Package

### `@affiliate-content-os/domain`

- `packages/domain/src/identity.ts`:
  - Defined normative types: `VerifiedIdentityClaims`, `AuthenticationSource`, `ApplicationPrincipal`.
  - Implemented `validateIdentityClaims(rawClaims: unknown)`:
    - Verifies plain object with prototype `Object.prototype` or `null`.
    - Enforces exact own keys (`identityProvider`, `identitySubject`, optional `email`, `displayName`); rejects symbols and unknown properties.
    - Rejects accessor properties (getters/setters) without executing them.
    - Requires non-empty `identityProvider` and `identitySubject` with zero leading/trailing whitespace; preserves casing and internal whitespace.
    - Trims `email` and `displayName`, normalizing empty trimmed strings to `null`.
    - Deep freezes returned structures via `Object.freeze`.
- `packages/domain/src/index.ts`: Re-exported domain identity types and validation functions.
- `packages/domain/test/identity.unit.test.ts`: 19 focused tests covering the entire validation matrix.

### `@affiliate-content-os/application`

- `packages/application/src/ports.ts`:
  - Added `IdentityLookupKey` and `UserIdentityDirectoryPort` (`findUsersByIdentity`, `insertUserIfAbsent`).
- `packages/application/src/errors.ts`:
  - Added `IdentityClaimField`, `IdentityClaimsValidationError`, `IdentityUnavailableError`, `IdentityPersistenceError`, `IdentityProvisioningRaceError`.
- `packages/application/src/resolve-verified-identity.ts`:
  - Translates every domain claims validation failure into `IdentityClaimsValidationError(field, 'Invalid identity claims')`.
  - Zero input metadata or domain error instances escape boundary.
  - Implements exact step order, active resolution, provisioning, losing-race recovery, and safe error precedence.
- `packages/application/src/index.ts`: Re-exported use case, command/dependency types, ports, and errors.
- `packages/application/test/resolve-verified-identity.unit.test.ts`: 16 comprehensive unit tests covering happy paths, hostility, and race conditions.

### `@affiliate-content-os/infrastructure`

- `packages/infrastructure/src/tenancy/mappers.ts`:
  - Extended `mapUserRow` with validation of canonical UUIDv7 `id`, non-empty provider/subject, `isUserStatus` status check, positive integer `version`, and canonical timestamps. Fails closed with safe `DatabaseError`.
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`:
  - Implemented `findUsersByIdentity`: parameterized `SELECT ... WHERE identity_provider = $1 AND identity_subject = $2 LIMIT 2`. Returns mapped snapshots; does not reject 2 rows in infrastructure.
  - Implemented `insertUserIfAbsent`: parameterized `INSERT ... ON CONFLICT (identity_provider, identity_subject) DO NOTHING RETURNING ...`. 0 rows -> `null`; 1 row -> mapped snapshot; >1 rows -> safe `DatabaseError`.
- `packages/infrastructure/test/unit/identity-adapter.unit.test.ts`: 11 unit tests with fake database verifying SQL text, parameter arrays, and row semantics.
- `packages/infrastructure/test/integration/identity-adapter.integration.test.ts`: 6 real PostgreSQL integration tests verifying provisioning, exact resolution, email independence, concurrent race recovery, inactive user fail-closed, and strictly unchanged relation set.

---

## 3. Verification Results

| Verification Check        | Command                                         | Status | Details                                                                  |
| ------------------------- | ----------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| Node.js Version           | `node --version`                                | PASSED | `v24.14.0`                                                               |
| pnpm Version              | `corepack pnpm --version`                       | PASSED | `12.4.2`                                                                 |
| Frozen Lockfile           | `corepack pnpm install --frozen-lockfile`       | PASSED | Lockfile up to date                                                      |
| Local Environment         | `corepack pnpm env:local`                       | PASSED | `.env` verified                                                          |
| Compose Config            | `docker compose config --quiet`                 | PASSED | Zero errors                                                              |
| Infrastructure Pins       | `corepack pnpm verify:infrastructure-pins`      | PASSED | Pinned PostgreSQL digest verified                                        |
| Infrastructure Startup    | `corepack pnpm infra:up`                        | PASSED | Healthy (5/5 authenticated queries verified)                             |
| Migration Validation      | `corepack pnpm db:migrate:validate`             | PASSED | 2 applied, second run 0 (no-op), clean teardown                          |
| Integration Tests         | `corepack pnpm test:integration`                | PASSED | 5 test files, 88 tests passed (100%) in 8.92s                            |
| Formatting Check          | `corepack pnpm format:check`                    | PASSED | Clean per Prettier                                                       |
| Boundary Linting          | `corepack pnpm lint:boundaries`                 | PASSED | 244 modules, 501 dependencies, 0 violations                              |
| Linting                   | `corepack pnpm lint`                            | PASSED | Clean (0 errors, 0 warnings)                                             |
| Type Checking             | `corepack pnpm typecheck`                       | PASSED | All 7 workspace projects clean                                           |
| Workspace Unit Tests      | `corepack pnpm test`                            | PASSED | 25 test files, 701 tests passed (100%) in 15.06s                         |
| Production Build          | `corepack pnpm build`                           | PASSED | All workspace artifacts built cleanly                                    |
| Aggregate Check           | `corepack pnpm check`                           | PASSED | Full local check pipeline clean (exit code 0)                            |
| Production Audit          | `corepack pnpm audit --prod --audit-level high` | PASSED | 0 high or critical vulnerabilities                                       |
| Security Exception Policy | `corepack pnpm verify:trivy-exception`          | PASSED | Exception `TASK-003-CVE-2025-68121-GOSU` verified                        |
| Pinned Image Inspection   | `docker buildx imagetools inspect`              | PASSED | Multi-arch manifest verified with exact digest                           |
| Trivy Review Scan         | `trivy image ... HIGH,CRITICAL`                 | PASSED | Exit code 0, 1 suppressed finding                                        |
| Trivy Blocking Scan       | `trivy image ... CRITICAL --ignore-unfixed`     | PASSED | Exit code 0, 0 unfixed critical vulnerabilities                          |
| Trivy Negative Control    | `trivy image ... without ignorefile`            | PASSED | Exit code 1, accurately flagged `CVE-2025-68121` on `usr/local/bin/gosu` |
| Runtime Smoke Tests       | API & Worker smoke scripts                      | PASSED | API `/health/live` returned HTTP 200; Worker entered idle state          |
| Infrastructure Shutdown   | `corepack pnpm infra:down`                      | PASSED | Container and network removed cleanly                                    |
| Git Diff Check            | `git diff --check origin/main...HEAD`           | PASSED | 0 whitespace or formatting errors                                        |
