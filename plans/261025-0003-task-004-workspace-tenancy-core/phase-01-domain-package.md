# Phase 01: Domain Package (@affiliate-content-os/domain)

## Context

- `tasks/TASK-004.md` section 1
- `docs/ARCHITECTURE.md` sections 2, 4, 14, 21
- `docs/DATABASE.md` section 2

## Requirements

- Create `packages/domain` as a framework-free package.
- Opaque user, workspace, and membership ID types (`UserId`, `WorkspaceId`, `MembershipId`) validated as canonical UUIDv7 strings.
- Closed sets:
  - `UserStatus`: `active`, `disabled`, `deletion_pending`
  - `WorkspaceStatus`: `active`, `suspended`, `deletion_pending`
  - `WorkspaceRole`: `owner`, `editor`, `viewer`
  - `MembershipStatus`: `active`, `suspended`, `removed`
- Immutable entity snapshots:
  - `UserSnapshot`: `id`, `identityProvider`, `identitySubject`, `email`, `displayName`, `status`, `createdAt`, `updatedAt`, `version`
  - `WorkspaceSnapshot`: `id`, `name`, `slug`, `timezone`, `brandVoice`, `defaultDisclosure`, `aiEnabled`, `status`, `createdAt`, `updatedAt`, `version`
  - `WorkspaceMembershipSnapshot`: `id`, `workspaceId`, `userId`, `role`, `status`, `invitedByUserId`, `joinedAt`, `createdAt`, `updatedAt`, `version`
- Deterministic validation:
  - Workspace name: non-empty after trimming
  - Normalized slug: lowercase ASCII letters, digits, and single hyphen-separated segments (`^[a-z0-9]+(-[a-z0-9]+)*$`)
  - IANA timezone: validated with standard runtime IANA database (`Intl.DateTimeFormat`), non-empty, requires `/` or `UTC`/`Etc/UTC`
  - Optional text fields: trimmed, empty string becomes `null`
- Files kept under 200 LOC per file.
- Comprehensive unit test suite covering acceptance and rejection matrix.
