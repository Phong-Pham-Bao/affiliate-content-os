import type {
  MembershipId,
  UserId,
  UserSnapshot,
  WorkspaceId,
  WorkspaceMembershipSnapshot,
  WorkspaceSnapshot,
  AuditEventId,
  AuditEventSnapshot,
  IdempotencyKeyId,
  IdempotencyRecordSnapshot,
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
  readonly idempotencyRecord: IdempotencyRecordSnapshot;
  readonly auditEvent: AuditEventSnapshot;
}

export interface CreateWorkspaceResult {
  readonly workspace: WorkspaceSnapshot;
  readonly membership: WorkspaceMembershipSnapshot;
  readonly idempotencyRecord: IdempotencyRecordSnapshot;
  readonly auditEvent: AuditEventSnapshot | null;
  readonly cached?: boolean | undefined;
}

export interface IdempotencyStorePort {
  findIdempotencyRecord(params: {
    readonly principalId: UserId;
    readonly routeKey: string;
    readonly keyHash: Uint8Array;
    readonly workspaceId?: WorkspaceId | undefined;
  }): Promise<IdempotencyRecordSnapshot | null>;
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

export interface WorkspaceAuthorizationPort {
  findMembership(params: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
  }): Promise<WorkspaceMembershipSnapshot | null>;
}

export interface ClockPort {
  now(): Date;
}

export interface AuditIdGeneratorPort {
  generateAuditEventId(): AuditEventId;
}
export interface AuditEventAppendPort {
  appendAuditEvent(event: AuditEventSnapshot): Promise<void>;
}

export interface IdGeneratorPort {
  generateId?(): string;
  generateWorkspaceId(): WorkspaceId;
  generateMembershipId(): MembershipId;
  generateUserId(): UserId;
  generateAuditEventId?(): AuditEventId;
  generateIdempotencyKeyId?(): IdempotencyKeyId;
}
