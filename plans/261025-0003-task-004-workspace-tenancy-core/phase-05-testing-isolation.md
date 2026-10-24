# Phase 05: Real-PostgreSQL Integration Testing

## Context

- `tasks/TASK-004.md` test plan & acceptance criteria 8, 9, 10
- `docs/DECISIONS.md` ADR-020

## Requirements

- Real-PostgreSQL 18.6 integration tests using `setupIsolatedTestDatabase`:
  - Verify migration applied correctly and verify table/column/constraint/index structures.
  - Test atomic workspace + owner creation.
  - Test rollback when membership insert fails (e.g. invalid foreign key or forced error).
  - Test concurrent slug collision handling (returns `SlugConflictError`).
  - Test duplicate external identity rejection in `users`.
  - Test duplicate membership rejection in `workspace_memberships`.
  - Test database constraint rejections: invalid roles, invalid statuses, invalid slugs, active membership without `joined_at`.
  - Test tenant isolation matrix: two users and two workspaces in both directions, verifying cross-tenant access returns `null`, and verifying suspended/removed memberships return `null`.
  - Test database error sanitization and typed error mapping.
