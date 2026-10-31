# Phase 03: Database Migration 0002 (Identity & Tenancy)

## Context

- `tasks/TASK-004.md` section 2
- `docs/DATABASE.md` section 2

## Requirements

- Add forward-only migration `packages/infrastructure/migrations/0002_identity_tenancy.sql`.
- Create exactly three tables: `users`, `workspaces`, `workspace_memberships`.
- Constraints:
  - `users`: PK `id`, unique `(identity_provider, identity_subject)`, check status in `('active', 'disabled', 'deletion_pending')`, check non-empty trimmed provider and subject, version >= 1, `updated_at >= created_at`.
  - `workspaces`: PK `id`, unique `slug`, check `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`, check status in `('active', 'suspended', 'deletion_pending')`, check non-empty trimmed name and timezone, `ai_enabled` boolean default false, version >= 1, `updated_at >= created_at`.
  - `workspace_memberships`: PK `id`, FK `workspaces(id)` ON DELETE RESTRICT, FK `users(id)` ON DELETE RESTRICT, FK `invited_by_user_id` -> `users(id)` ON DELETE RESTRICT, unique `(workspace_id, user_id)`, check role in `('owner', 'editor', 'viewer')`, check status in `('active', 'suspended', 'removed')`, check `status <> 'active' OR joined_at IS NOT NULL`, version >= 1, `updated_at >= created_at`.
- Indexes:
  - `idx_workspace_memberships_user_workspace`: `(user_id, workspace_id)`
  - `idx_workspace_memberships_workspace_status`: `(workspace_id, status)`
- No triggers, extensions, down migrations, seed data, or additional tables.
- Migration validation check passes cleanly.
