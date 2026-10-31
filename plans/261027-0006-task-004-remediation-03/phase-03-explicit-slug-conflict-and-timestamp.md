# Phase 03: Explicit Slug Conflict and Membership Timestamp

## Context

- `tasks/TASK-004-REMEDIATION-03.md` Sections 4 and 5
- `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`
- `packages/infrastructure/src/tenancy/mappers.ts`

## Requirements

- In `PostgresTenancyAdapter.createWorkspaceWithOwner`:
  - Use `ON CONFLICT (slug) DO NOTHING RETURNING id`.
  - Check `result.rowCount === 0`. If true, `throw new SlugConflictError(params.workspace.slug);`.
  - If `result.rowCount === 1`, continue with membership insert.
  - Remove `isSlugConflictError` function, raw code/constraint inspection, and unused imports.
  - Remove try/catch around workspace insert that inspected raw errors.
  - Preserve outer catch: only `err instanceof SlugConflictError` rethrows as conflict, all else sanitizes with `sanitizeDatabaseError(err)`.
- In `mapMembershipRow`:
  - `joined_at: row.joined_at === null ? null : mapRowTimestamp(row.joined_at, 'joined_at')`.
  - Exactly `null` maps to `null`.
  - `undefined` or any other invalid value throws safe `DatabaseError`.

## Implementation Steps

1. Update `packages/infrastructure/src/tenancy/postgres-tenancy-adapter.ts`.
2. Update `packages/infrastructure/src/tenancy/mappers.ts`.
3. Update and expand tests in `tenancy-adapter.unit.test.ts` and integration tests.
