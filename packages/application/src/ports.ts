import type {
  MembershipId,
  UserId,
  UserSnapshot,
  WorkspaceId,
  WorkspaceMembershipSnapshot,
  WorkspaceSnapshot,
} from '@affiliate-content-os/domain';

export interface UserDirectoryPort {
  findUserById(userId: UserId): Promise<UserSnapshot | null>;
}

export interface IdentityLookupKey {
  readonly identityProvider: string;
  readonly identitySubject: string;
}

export interface UserIdentityDirectoryPort {
  findUsersByIdentity(key: IdentityLookupKey): Promise<readonly UserSnapshot[]>;
  insertUserIfAbsent(params: { readonly user: UserSnapshot }): Promise<UserSnapshot | null>;
}

export interface CreateWorkspaceWithOwnerParams {
  readonly workspace: WorkspaceSnapshot;
  readonly membership: WorkspaceMembershipSnapshot;
}

export interface CreateWorkspaceResult {
  readonly workspace: WorkspaceSnapshot;
  readonly membership: WorkspaceMembershipSnapshot;
}

export interface WorkspacePersistencePort {
  createWorkspaceWithOwner(params: CreateWorkspaceWithOwnerParams): Promise<CreateWorkspaceResult>;

  findWorkspaceByIdForUser(params: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
  }): Promise<WorkspaceSnapshot | null>;

  findMembership(params: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
  }): Promise<WorkspaceMembershipSnapshot | null>;
}

export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  generateWorkspaceId(): WorkspaceId;
  generateMembershipId(): MembershipId;
  generateUserId(): UserId;
}
