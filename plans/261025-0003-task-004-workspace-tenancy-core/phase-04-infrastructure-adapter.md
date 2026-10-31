# Phase 04: PostgreSQL Tenancy Adapter (@affiliate-content-os/infrastructure/tenancy)

## Context

- `tasks/TASK-004.md` section 3
- `docs/ARCHITECTURE.md` sections 2, 6, 14, 15

## Requirements

- Export `./tenancy` from `@affiliate-content-os/infrastructure`.
- Implement `UserDirectoryPort` and `WorkspacePersistencePort`:
  - `findUserById`: query `users` table by `id`, map row explicitly to `UserSnapshot`.
  - `createWorkspaceWithOwner`: atomic transaction via `database.withTransaction`. Inserts workspace and membership rows. Maps slug unique violation to `SlugConflictError`. Returns snapshots.
  - `findWorkspaceByIdForUser`: parameterized query joining `workspaces` and `workspace_memberships` requiring `w.id = $1 AND wm.user_id = $2 AND wm.status = 'active'`. Returns `null` if not found or inactive.
  - `findMembership`: parameterized query on `workspace_memberships` requiring `workspace_id = $1 AND user_id = $2 AND status = 'active'`. Returns `null` if not found or inactive.
- No global state, no ambient context, no environment reads in repository methods.
- Explicit row mapping, parameterized queries.
