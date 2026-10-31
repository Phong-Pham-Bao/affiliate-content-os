import {
  isUserStatus,
  isValidUuidV7,
  parseIsoTimestamp,
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type IsoTimestamp,
  type MembershipStatus,
  type UserSnapshot,
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
  try {
    if (!row || typeof row !== 'object') {
      throw new DatabaseError('Invalid user row object');
    }
    if (!isValidUuidV7(row.id)) {
      throw new DatabaseError('Invalid user ID in database row');
    }
    if (typeof row.identity_provider !== 'string' || row.identity_provider.length === 0) {
      throw new DatabaseError('Invalid identity_provider in database row');
    }
    if (typeof row.identity_subject !== 'string' || row.identity_subject.length === 0) {
      throw new DatabaseError('Invalid identity_subject in database row');
    }
    if (!isUserStatus(row.status)) {
      throw new DatabaseError('Invalid user status in database row');
    }
    const version = Number(row.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new DatabaseError('Invalid user version in database row');
    }
    const email = row.email === null || row.email === undefined ? null : String(row.email);
    const displayName =
      row.display_name === null || row.display_name === undefined ? null : String(row.display_name);

    return Object.freeze({
      id: parseUserId(row.id),
      identityProvider: row.identity_provider,
      identitySubject: row.identity_subject,
      email,
      displayName,
      status: row.status,
      createdAt: mapRowTimestamp(row.created_at, 'created_at'),
      updatedAt: mapRowTimestamp(row.updated_at, 'updated_at'),
      version,
    });
  } catch (err) {
    if (err instanceof DatabaseError) {
      throw err;
    }
    throw new DatabaseError('Failed to map user row');
  }
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
