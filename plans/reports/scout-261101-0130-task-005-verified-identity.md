# Scout Report: TASK-005 Verified Identity Provisioning

Date: 261101-0130
Task: TASK-005 Verified OIDC Identity Provisioning Boundary
Branch: agy/task-005-verified-identity
Base: origin/main (f8a39fe)

## Codebase Findings

- Monorepo package structure:
  - `packages/domain`: provides `UserSnapshot`, `UserStatus`, `IsoTimestamp`, `UserId`, `parseUserId`, `dateToIsoTimestamp`, etc.
  - `packages/application`: provides `ApplicationError`, `ClockPort`, `IdGeneratorPort`, `createWorkspace`.
  - `packages/infrastructure`: provides `PostgresTenancyAdapter`, `mapUserRow`, `RawUserRow`, `Database`, `DatabaseError`.
- TASK-005 requires adding:
  - In `packages/domain/src/identity.ts`: `VerifiedIdentityClaims`, `AuthenticationSource`, `ApplicationPrincipal`, safe claims validation primitives.
  - In `packages/domain/src/errors.ts`: domain-scoped validation error for identity claims validation.
  - In `packages/domain/src/index.ts`: re-exports of identity types/helpers.
  - In `packages/application/src/ports.ts`: `IdentityLookupKey`, `UserIdentityDirectoryPort`.
  - In `packages/application/src/errors.ts`: `IdentityClaimField`, `IdentityClaimsValidationError`, `IdentityUnavailableError`, `IdentityPersistenceError`, `IdentityProvisioningRaceError`.
  - In `packages/application/src/resolve-verified-identity.ts`: `resolveVerifiedIdentity` implementation.
  - In `packages/application/src/index.ts`: re-exports of application identity contracts and errors.
  - In `packages/infrastructure/src/tenancy/mappers.ts`: extend `mapUserRow` with safe status/version/ID/timestamp checks.
  - In `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`: implement `UserIdentityDirectoryPort` (`findUsersByIdentity` and `insertUserIfAbsent`).
  - In `packages/infrastructure/src/tenancy/index.ts`: re-export updated adapter.
- Tests to add:
  - `packages/domain/test/identity.unit.test.ts`
  - `packages/application/test/resolve-verified-identity.unit.test.ts`
  - `packages/infrastructure/test/unit/identity-adapter.unit.test.ts`
  - `packages/infrastructure/test/integration/identity-adapter.integration.test.ts`

No ambiguity, contradiction, or infeasibility identified. Ready to proceed with execution checklist.
