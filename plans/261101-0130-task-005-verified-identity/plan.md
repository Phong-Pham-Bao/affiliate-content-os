---
title: 'TASK-005: Verified OIDC Identity Provisioning Boundary'
description: 'Implementation of approved TASK-005: domain identity/claims contracts, application ports and resolveVerifiedIdentity use case, PostgreSQL identity directory adapter, safe row mapping, and isolation/concurrency tests.'
status: completed
priority: P1
effort: 6h
branch: agy/task-005-verified-identity
tags:
  - domain
  - application
  - identity
  - tenancy
  - postgresql
  - concurrency
created: 2026-11-01
---

# TASK-005: Verified OIDC Identity Provisioning Boundary Plan

## Phase Overview

- [x] **Phase 1: Domain Package (@affiliate-content-os/domain)** - `phase-01-domain-identity.md`
  - Types: `VerifiedIdentityClaims`, `AuthenticationSource`, `ApplicationPrincipal`.
  - Validation: plain object verification, exact own keys, accessor rejection, whitespace rejection on provider/subject, trim-only metadata, frozen returns, domain-local error.
  - Focused test: `corepack pnpm exec vitest run packages/domain/test/identity.unit.test.ts`.

- [x] **Phase 2: Application Package (@affiliate-content-os/application)** - `phase-02-application-identity.md`
  - Ports: `IdentityLookupKey`, `UserIdentityDirectoryPort`.
  - Errors: `IdentityClaimField`, `IdentityClaimsValidationError`, `IdentityUnavailableError`, `IdentityPersistenceError`, `IdentityProvisioningRaceError`.
  - Error translation: translate all domain/claims failures to `IdentityClaimsValidationError`; no domain errors or metadata escape boundary.
  - Use case: `resolveVerifiedIdentity` with exact step order, precedence, immutability, and hostile fakes.
  - Focused test: `corepack pnpm exec vitest run packages/application/test/resolve-verified-identity.unit.test.ts`.

- [x] **Phase 3: Infrastructure Tenancy / Identity Adapter (@affiliate-content-os/infrastructure/tenancy)** - `phase-03-infrastructure-identity.md`
  - Safe row mapping in `mappers.ts`: status, version, id, timestamps, frozen snapshots.
  - Adapter in `postgres-tenancy-adapter.ts`:
    - `findUsersByIdentity`: 0 -> `[]`, 1 -> `[snapshot]`, 2 -> `[snapshot1, snapshot2]` (application rejects multiple).
    - `insertUserIfAbsent`: 0 -> `null`, 1 -> `snapshot`, >1 -> safe `DatabaseError`.
  - Focused test: `corepack pnpm exec vitest run packages/infrastructure/test/unit/identity-adapter.unit.test.ts`.

- [x] **Phase 4: Real PostgreSQL Integration & Security Tests** - `phase-04-integration-concurrency.md`
  - Real PostgreSQL 18.6 integration tests: provisioning, exact identity resolution, email independence, concurrent race recovery, disabled/deletion-pending fail-closed.
  - Integration test: `corepack pnpm test:integration`.

- [x] **Phase 5: Quality Gates, Boundary Verification & Clean-Checkout** - `phase-05-verification-gates.md`
  - Repository-wide test: `corepack pnpm test`.
  - Full gates: environment, compose, pins, migrations, format, boundaries, lint, typecheck, test, build, audit, trivy scans, negative control, smoke tests, clean-checkout, exact-SHA verification.
