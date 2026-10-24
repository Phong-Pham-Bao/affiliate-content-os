# Phase 02: Application Package (@affiliate-content-os/application)

## Context

- `tasks/TASK-004.md` section 1, section 5
- `docs/ARCHITECTURE.md` section 2, 6, 17

## Requirements

- Create `packages/application` depending only on `@affiliate-content-os/domain`.
- Narrow ports:
  - `UserDirectoryPort`: `findUserById(userId: UserId): Promise<UserSnapshot | null>`
  - `WorkspacePersistencePort`:
    - `createWorkspaceWithOwner(params: CreateWorkspaceWithOwnerParams): Promise<CreateWorkspaceResult>`
    - `findWorkspaceByIdForUser(params: { workspaceId: WorkspaceId; userId: UserId }): Promise<WorkspaceSnapshot | null>`
    - `findMembership(params: { workspaceId: WorkspaceId; userId: UserId }): Promise<WorkspaceMembershipSnapshot | null>`
  - `ClockPort`: `now(): Date`
  - `IdGeneratorPort`: `generateWorkspaceId(): WorkspaceId; generateMembershipId(): MembershipId; generateUserId(): UserId`
- Explicit typed application errors:
  - `UserNotFoundError`: initiating user does not exist
  - `InactiveUserError`: initiating user is not active (`disabled` or `deletion_pending`)
  - `SlugConflictError`: workspace with normalized slug already exists
  - `ValidationError`: invalid inputs (empty name, invalid slug format, invalid timezone, etc.)
- `CreateWorkspace` use case:
  - Input: `userId`, `name`, `slug`, `timezone`, `brandVoice?`, `defaultDisclosure?`, `aiEnabled?`
  - Validates and normalizes inputs
  - Verifies user exists and is `active`
  - Injects deterministic IDs and current timestamp
  - Sets workspace `status = 'active'`, `version = 1`
  - Sets owner membership `role = 'owner'`, `status = 'active'`, `joinedAt = now`, `version = 1`
  - Delegates atomic persistence to port
  - Returns immutable workspace snapshot and owner membership snapshot
- Application unit tests with deterministic fakes.
