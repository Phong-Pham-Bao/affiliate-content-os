# Phase 02: Application Package (@affiliate-content-os/application)

## Context Links

- `tasks/TASK-005.md` sections 1, 2, 4, 5
- `docs/ARCHITECTURE.md` sections 2, 6, 17
- `packages/application/src/ports.ts`
- `packages/application/src/errors.ts`

## Overview

Status: completed  
Priority: high  
Implement application ports, typed identity errors, error translation boundary, and the `resolveVerifiedIdentity` use case with explicit lookup/insert/recovery semantics.

## Requirements

- Exact ports in `packages/application/src/ports.ts`:
  - `IdentityLookupKey`:
    - `readonly identityProvider: string`
    - `readonly identitySubject: string`
  - `UserIdentityDirectoryPort`:
    - `findUsersByIdentity(key: IdentityLookupKey): Promise<readonly UserSnapshot[]>`
    - `insertUserIfAbsent(params: { readonly user: UserSnapshot }): Promise<UserSnapshot | null>`
- Exact public errors in `packages/application/src/errors.ts`:
  - `IdentityClaimField = 'claims' | 'identityProvider' | 'identitySubject' | 'email' | 'displayName'`
  - `IdentityClaimsValidationError`: `code: 'IDENTITY_CLAIMS_INVALID'`, `readonly field: IdentityClaimField`
  - `IdentityUnavailableError`: `code: 'IDENTITY_UNAVAILABLE'` (used for both disabled and deletion-pending users)
  - `IdentityPersistenceError`: `code: 'IDENTITY_PERSISTENCE_INVALID'`, `readonly operation: 'lookup' | 'insert' | 'recovery'`
  - `IdentityProvisioningRaceError`: `code: 'IDENTITY_PROVISIONING_RACE'`, `readonly retryable: true`
- Error translation & boundary non-disclosure:
  - Domain validation may use a domain-local validation primitive/error internally.
  - `resolveVerifiedIdentity` must translate every claims validation failure into the exact application-facing `IdentityClaimsValidationError`.
  - No domain validation error or input metadata (no raw provider, subject, email, displayName, tokens) may escape the application boundary. Fixed safe messages only.
- Exact orchestration sequence & result semantics:
  1. Validate claims: on failure, throw `IdentityClaimsValidationError`; call zero dependencies (no clock, no ID generator, no persistence).
  2. Initial lookup: call `identityDirectory.findUsersByIdentity({ identityProvider, identitySubject })` once.
     - 0 rows (`[]`): proceed to step 3 (provisioning).
     - 1 row (`[snapshot]`):
       - If `status === 'active'` and exact provider/subject match, return frozen `ApplicationPrincipal`.
       - If `status === 'disabled'` or `status === 'deletion_pending'`, throw `IdentityUnavailableError`.
       - Any other status, malformed snapshot, or mismatched identity throws `IdentityPersistenceError('lookup')`.
     - 2 rows: application rejects multiple users with `IdentityPersistenceError('lookup')`.
  3. Provisioning (zero rows path):
     - Call `deps.clock.now()` once; validate Date; convert with `dateToIsoTimestamp`.
     - Call `deps.idGenerator.generateUserId()` once.
     - Construct frozen active `UserSnapshot` (status `active`, version `1`, `createdAt === updatedAt`).
     - Call `identityDirectory.insertUserIfAbsent({ user })` once.
     - If snapshot returned (1 row): verify exact fields, active status, version 1, matching timestamps. Valid returns frozen `ApplicationPrincipal`; mismatch/malformed throws `IdentityPersistenceError('insert')`.
     - If `null` returned (0 rows due to race conflict): proceed to step 4 (losing-race recovery).
  4. Losing-race recovery (insert returned `null`):
     - Call `identityDirectory.findUsersByIdentity` once.
     - 0 rows (`[]`): throw `IdentityProvisioningRaceError` (`retryable: true`).
     - 1 row (`[snapshot]`):
       - If `status === 'active'` and exact match, return frozen `ApplicationPrincipal`.
       - If `status === 'disabled'` or `status === 'deletion_pending'`, throw `IdentityUnavailableError`.
       - Mismatched identity, invalid status, or malformed snapshot throws `IdentityPersistenceError('recovery')`.
     - 2 rows: application rejects multiple users with `IdentityPersistenceError('recovery')`.
- Tests in `packages/application/test/resolve-verified-identity.unit.test.ts`.

## Focused Test Command

```bash
corepack pnpm exec vitest run packages/application/test/resolve-verified-identity.unit.test.ts
```

## Actual Results

- Tests: 16 passed (16 total) in 47ms
- Typecheck: passed cleanly with zero errors
- Diff inspection: scoped strictly to `packages/application/src/ports.ts`, `packages/application/src/errors.ts`, `packages/application/src/resolve-verified-identity.ts`, `packages/application/src/index.ts`, and `packages/application/test/resolve-verified-identity.unit.test.ts`.
