# Phase 04: Real PostgreSQL Integration & Security Tests

## Context Links

- `tasks/TASK-005.md` sections 3, 5, test plan
- `docs/DATABASE.md` section 2
- `packages/infrastructure/test/integration/`

## Overview

Status: completed  
Priority: high  
Prove real PostgreSQL lookup, creation, uniqueness, and concurrent losing-race recovery against isolated PostgreSQL 18.6 containers.

## Requirements

- Integration tests in `packages/infrastructure/test/integration/identity-adapter.integration.test.ts`:
  - Run using guarded isolated database (`TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_DISPOSABLE`).
  - Create unique active user and resolve by exact `(identityProvider, identitySubject)`.
  - Provision missing identity: exactly one row, active status, version 1, equal canonical timestamps, trimmed metadata.
  - Resolve same identity with different email: existing row returned unchanged without metadata overwrite.
  - Same subject across two different providers: creates two distinct, independent user records.
  - Concurrent first provisioning: two simultaneous requests for the same identity; exactly one row created, one succeeds via insert, one succeeds via losing-race recovery.
  - Uniqueness target strictly `(identity_provider, identity_subject)`; email is never unique key or conflict target.
  - Disabled and deletion-pending users: fail closed with `IdentityUnavailableError` without reactivation or metadata change.
  - Clean-up through guarded lifecycle helper.

## Integration Test Command

```bash
corepack pnpm test:integration
```

## Actual Results

- Integration suite: 5 test files, 88 tests passed (100%) in 8.92s
  - `identity-adapter.integration.test.ts`: 6 passed
  - `tenancy-schema.integration.test.ts`: 56 passed
  - `database.integration.test.ts`: 14 passed
  - `tenancy-adapter.integration.test.ts`: 4 passed
  - `migrations.integration.test.ts`: 8 passed
- Verified exact single-row constraint behavior, concurrency recovery, inactive status fail-closed, and strictly unchanged relation set (`schema_migrations`, `users`, `workspaces`, `workspace_memberships`).
