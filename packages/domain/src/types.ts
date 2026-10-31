import type { MembershipId, UserId, WorkspaceId } from './ids.js';
import type { IsoTimestamp } from './timestamps.js';

export type { IsoTimestamp };

export const USER_STATUSES = ['active', 'disabled', 'deletion_pending'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const WORKSPACE_STATUSES = ['active', 'suspended', 'deletion_pending'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const WORKSPACE_ROLES = ['owner', 'editor', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'suspended', 'removed'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value);
}

export function isWorkspaceStatus(value: unknown): value is WorkspaceStatus {
  return typeof value === 'string' && (WORKSPACE_STATUSES as readonly string[]).includes(value);
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

export interface UserSnapshot {
  readonly id: UserId;
  readonly identityProvider: string;
  readonly identitySubject: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly status: UserStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface WorkspaceSnapshot {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly brandVoice: string | null;
  readonly defaultDisclosure: string | null;
  readonly aiEnabled: boolean;
  readonly status: WorkspaceStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export interface WorkspaceMembershipSnapshot {
  readonly id: MembershipId;
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly role: WorkspaceRole;
  readonly status: MembershipStatus;
  readonly invitedByUserId: UserId | null;
  readonly joinedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}
