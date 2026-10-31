# Phase 03: Infrastructure Tenancy / Identity Adapter (@affiliate-content-os/infrastructure/tenancy)

## Context Links

- `tasks/TASK-005.md` sections 3, 4, 5
- `docs/ARCHITECTURE.md` sections 2, 6, 14, 15
- `packages/infrastructure/src/tenancy/mappers.ts`
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`

## Overview

Status: completed  
Priority: high  
Implement PostgreSQL persistence for identity lookup and provisioning with explicit row-count semantics and safe database error wrapping.

## Requirements

- Extend user row mapping in `packages/infrastructure/src/tenancy/mappers.ts`:
  - Validate status (`active`, `disabled`, `deletion_pending`), version (positive integer), canonical UUIDv7 ID, and canonical ISO timestamps.
  - Return frozen immutable `UserSnapshot`.
  - Malformed row values fail closed with safe `DatabaseError`.
- Implement `UserIdentityDirectoryPort` in `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`:
  - **`findUsersByIdentity`**:
    - Parameterized query:
      ```sql
      SELECT id, identity_provider, identity_subject, email, display_name,
             status, created_at, updated_at, version
      FROM users
      WHERE identity_provider = $1
        AND identity_subject = $2
      LIMIT 2
      ```
    - Parameters: `[key.identityProvider, key.identitySubject]`
    - Exact result semantics:
      - 0 rows => return `[]`
      - 1 row => return `[mapped snapshot]`
      - 2 rows => return both mapped snapshots (`[snapshot1, snapshot2]`) to the application.
      - **Do NOT reject the lookup's two-row result inside infrastructure; the application layer rejects multiple users with `IdentityPersistenceError`.**
  - **`insertUserIfAbsent`**:
    - Parameterized statement:
      ```sql
      INSERT INTO users (
        id, identity_provider, identity_subject, email, display_name,
        status, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (identity_provider, identity_subject) DO NOTHING
      RETURNING id, identity_provider, identity_subject, email, display_name,
                status, created_at, updated_at, version
      ```
    - Parameters: `[user.id, user.identityProvider, user.identitySubject, user.email, user.displayName, user.status, user.createdAt, user.updatedAt, user.version]`
    - Exact result semantics:
      - 0 rows => return `null`
      - 1 row => return mapped `UserSnapshot`
      - more than 1 row => throw safe `DatabaseError`
- Safety:
  - No raw driver values, constraint names, bind values, or identity metadata escape in logs or errors.
  - No package scripts added; keep existing scripts intact.
- Unit tests in `packages/infrastructure/test/unit/identity-adapter.unit.test.ts`.

## Focused Test Command

```bash
corepack pnpm exec vitest run packages/infrastructure/test/unit/identity-adapter.unit.test.ts
```

## Actual Results

- Tests: 11 passed (11 total) in 46ms
- Existing tenancy unit tests: 213 passed (213 total) in 1051ms
- Typecheck: passed cleanly with zero errors
- Diff inspection: scoped strictly to `packages/infrastructure/src/tenancy/mappers.ts`, `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`, and `packages/infrastructure/test/unit/identity-adapter.unit.test.ts`.
