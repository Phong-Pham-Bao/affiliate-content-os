import {
  parseIsoTimestamp,
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type IsoTimestamp,
  type MembershipStatus,
  type UserSnapshot,
  type UserStatus,
  type WorkspaceMembershipSnapshot,
  type WorkspaceRole,
  type WorkspaceSnapshot,
  type WorkspaceStatus,
} from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

export interface RawUserRow {
  readonly id: string;
  readonly identity_provider: string;
  readonly identity_subject: string;
  readonly email: string | null;
  readonly display_name: string | null;
  readonly status: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly version: string | number | bigint;
}

export interface RawWorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly brand_voice: string | null;
  readonly default_disclosure: string | null;
  readonly ai_enabled: boolean;
  readonly status: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly version: string | number | bigint;
}

export interface RawMembershipRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly user_id: string;
  readonly role: string;
  readonly status: string;
  readonly invited_by_user_id: string | null;
  readonly joined_at: string | Date | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly version: string | number | bigint;
}

function mapRowTimestamp(value: unknown, fieldName: string): IsoTimestamp {
  try {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new DatabaseError(`Invalid timestamp value for field "${fieldName}"`);
      }
      return parseIsoTimestamp(value.toISOString());
    }
    if (typeof value === 'string') {
      return parseIsoTimestamp(value);
    }
    throw new DatabaseError(`Invalid timestamp value for field "${fieldName}"`);
  } catch (err) {
    if (err instanceof DatabaseError) {
      throw err;
    }
    throw new DatabaseError(`Invalid timestamp value for field "${fieldName}"`);
  }
}

export function mapUserRow(row: RawUserRow): UserSnapshot {
  return Object.freeze({
    id: parseUserId(row.id),
    identityProvider: row.identity_provider,
    identitySubject: row.identity_subject,
    email: row.email,
    displayName: row.display_name,
    status: row.status as UserStatus,
    createdAt: mapRowTimestamp(row.created_at, 'created_at'),
    updatedAt: mapRowTimestamp(row.updated_at, 'updated_at'),
    version: Number(row.version),
  });
}

export function mapWorkspaceRow(row: RawWorkspaceRow): WorkspaceSnapshot {
  return Object.freeze({
    id: parseWorkspaceId(row.id),
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    brandVoice: row.brand_voice,
    defaultDisclosure: row.default_disclosure,
    aiEnabled: Boolean(row.ai_enabled),
    status: row.status as WorkspaceStatus,
    createdAt: mapRowTimestamp(row.created_at, 'created_at'),
    updatedAt: mapRowTimestamp(row.updated_at, 'updated_at'),
    version: Number(row.version),
  });
}

export function mapMembershipRow(row: RawMembershipRow): WorkspaceMembershipSnapshot {
  return Object.freeze({
    id: parseMembershipId(row.id),
    workspaceId: parseWorkspaceId(row.workspace_id),
    userId: parseUserId(row.user_id),
    role: row.role as WorkspaceRole,
    status: row.status as MembershipStatus,
    invitedByUserId: row.invited_by_user_id ? parseUserId(row.invited_by_user_id) : null,
    joinedAt: row.joined_at === null ? null : mapRowTimestamp(row.joined_at, 'joined_at'),
    createdAt: mapRowTimestamp(row.created_at, 'created_at'),
    updatedAt: mapRowTimestamp(row.updated_at, 'updated_at'),
    version: Number(row.version),
  });
}
