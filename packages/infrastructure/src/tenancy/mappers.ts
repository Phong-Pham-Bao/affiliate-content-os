import util from 'node:util';
import {
  isUserStatus,
  isValidIsoTimestamp,
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

function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

const MAX_SAFE_INTEGER_STRING = '9007199254740991';

function mapSafeUserTimestamp(value: unknown): IsoTimestamp {
  if (typeof value === 'string') {
    if (!isValidIsoTimestamp(value)) {
      throw new DatabaseError('Failed to map user row');
    }
    return value;
  }

  if (typeof value === 'object' && value !== null) {
    if (isProxySafe(value)) {
      throw new DatabaseError('Failed to map user row');
    }
    if (Object.getPrototypeOf(value) !== Date.prototype) {
      throw new DatabaseError('Failed to map user row');
    }
    if (Reflect.ownKeys(value).length !== 0) {
      throw new DatabaseError('Failed to map user row');
    }
    const epoch = Date.prototype.getTime.call(value);
    if (typeof epoch !== 'number' || !Number.isFinite(epoch)) {
      throw new DatabaseError('Failed to map user row');
    }
    const freshDate = new Date(epoch);
    const isoString = Date.prototype.toISOString.call(freshDate);
    if (!isValidIsoTimestamp(isoString)) {
      throw new DatabaseError('Failed to map user row');
    }
    return isoString;
  }

  throw new DatabaseError('Failed to map user row');
}

function mapSafeUserVersion(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
      throw new DatabaseError('Failed to map user row');
    }
    return value;
  }

  if (typeof value === 'string') {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new DatabaseError('Failed to map user row');
    }
    if (value.length > MAX_SAFE_INTEGER_STRING.length) {
      throw new DatabaseError('Failed to map user row');
    }
    if (value.length === MAX_SAFE_INTEGER_STRING.length && value > MAX_SAFE_INTEGER_STRING) {
      throw new DatabaseError('Failed to map user row');
    }
    const num = Number(value);
    if (!Number.isSafeInteger(num) || num < 1 || num > Number.MAX_SAFE_INTEGER) {
      throw new DatabaseError('Failed to map user row');
    }
    return num;
  }

  if (typeof value === 'bigint') {
    if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new DatabaseError('Failed to map user row');
    }
    return Number(value);
  }

  throw new DatabaseError('Failed to map user row');
}

const REQUIRED_USER_ROW_KEYS = [
  'id',
  'identity_provider',
  'identity_subject',
  'email',
  'display_name',
  'status',
  'created_at',
  'updated_at',
  'version',
] as const;

export function mapUserRow(row: RawUserRow): UserSnapshot {
  try {
    const raw: unknown = row;
    if (typeof raw !== 'object' || raw === null || isProxySafe(raw)) {
      throw new DatabaseError('Failed to map user row');
    }

    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) {
      throw new DatabaseError('Failed to map user row');
    }

    const ownKeys = Reflect.ownKeys(raw);
    if (ownKeys.length !== REQUIRED_USER_ROW_KEYS.length) {
      throw new DatabaseError('Failed to map user row');
    }

    let idVal: unknown;
    let provVal: unknown;
    let subVal: unknown;
    let emailVal: unknown;
    let displayNameVal: unknown;
    let statusVal: unknown;
    let createdAtVal: unknown;
    let updatedAtVal: unknown;
    let versionVal: unknown;

    for (const key of REQUIRED_USER_ROW_KEYS) {
      const desc = Object.getOwnPropertyDescriptor(raw, key);
      if (!desc || desc.get !== undefined || desc.set !== undefined) {
        throw new DatabaseError('Failed to map user row');
      }
      switch (key) {
        case 'id':
          idVal = desc.value;
          break;
        case 'identity_provider':
          provVal = desc.value;
          break;
        case 'identity_subject':
          subVal = desc.value;
          break;
        case 'email':
          emailVal = desc.value;
          break;
        case 'display_name':
          displayNameVal = desc.value;
          break;
        case 'status':
          statusVal = desc.value;
          break;
        case 'created_at':
          createdAtVal = desc.value;
          break;
        case 'updated_at':
          updatedAtVal = desc.value;
          break;
        case 'version':
          versionVal = desc.value;
          break;
      }
    }

    if (typeof idVal !== 'string' || !isValidUuidV7(idVal)) {
      throw new DatabaseError('Failed to map user row');
    }
    const id = parseUserId(idVal);

    if (typeof provVal !== 'string' || provVal.length === 0 || provVal.trim() !== provVal) {
      throw new DatabaseError('Failed to map user row');
    }

    if (typeof subVal !== 'string' || subVal.length === 0 || subVal.trim() !== subVal) {
      throw new DatabaseError('Failed to map user row');
    }

    if (emailVal !== null && typeof emailVal !== 'string') {
      throw new DatabaseError('Failed to map user row');
    }

    if (displayNameVal !== null && typeof displayNameVal !== 'string') {
      throw new DatabaseError('Failed to map user row');
    }

    if (typeof statusVal !== 'string' || !isUserStatus(statusVal)) {
      throw new DatabaseError('Failed to map user row');
    }

    const createdAt = mapSafeUserTimestamp(createdAtVal);
    const updatedAt = mapSafeUserTimestamp(updatedAtVal);
    const version = mapSafeUserVersion(versionVal);

    return Object.freeze({
      id,
      identityProvider: provVal,
      identitySubject: subVal,
      email: emailVal,
      displayName: displayNameVal,
      status: statusVal,
      createdAt,
      updatedAt,
      version,
    });
  } catch {
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
