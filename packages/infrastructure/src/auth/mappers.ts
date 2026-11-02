import util from 'node:util';
import { isValidUuidV7, type IsoTimestamp } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';

function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

function parseIsoTimestamp(val: unknown): IsoTimestamp {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(val)) {
    return val as IsoTimestamp;
  }
  if (typeof val === 'object' && val !== null && !isProxySafe(val)) {
    if (Object.getPrototypeOf(val) === Date.prototype) {
      const epoch = Date.prototype.getTime.call(val);
      if (Number.isFinite(epoch)) {
        return new Date(epoch).toISOString() as IsoTimestamp;
      }
    }
  }
  throw new DatabaseError('Failed to map row timestamp');
}

function parseVersion(val: unknown): number {
  if (typeof val === 'number' && Number.isSafeInteger(val) && val >= 1) {
    return val;
  }
  if (typeof val === 'string' && /^[1-9]\d*$/.test(val)) {
    const num = Number.parseInt(val, 10);
    if (Number.isSafeInteger(num) && num >= 1) {
      return num;
    }
  }
  if (typeof val === 'bigint' && val >= 1n && val <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(val);
  }
  throw new DatabaseError('Failed to map row version');
}

function copyBytes(val: unknown): Uint8Array | null {
  if (val === null || val === undefined) {
    return null;
  }
  if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
  }
  throw new DatabaseError('Failed to map byte column');
}

export interface ConsumedLoginTransactionRow {
  readonly id: string;
  readonly keyVersion: string;
  readonly returnTo: string;
  readonly secretsCiphertext: Uint8Array;
  readonly secretsIv: Uint8Array;
  readonly secretsAuthTag: Uint8Array;
  readonly createdAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
}

export function mapConsumedTransactionRow(rawRow: unknown): ConsumedLoginTransactionRow {
  if (typeof rawRow !== 'object' || rawRow === null || isProxySafe(rawRow)) {
    throw new DatabaseError('Failed to map transaction row');
  }
  const proto = Object.getPrototypeOf(rawRow);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Failed to map transaction row');
  }
  const row = rawRow as Record<string, unknown>;

  if (typeof row['id'] !== 'string' || !isValidUuidV7(row['id'])) {
    throw new DatabaseError('Failed to map transaction row');
  }
  if (
    typeof row['key_version'] !== 'string' ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(row['key_version'])
  ) {
    throw new DatabaseError('Failed to map transaction row');
  }
  if (typeof row['return_to'] !== 'string' || row['return_to'].length > 2048) {
    throw new DatabaseError('Failed to map transaction row');
  }

  const ciphertext = copyBytes(row['secrets_ciphertext']);
  const iv = copyBytes(row['secrets_iv']);
  const tag = copyBytes(row['secrets_auth_tag']);

  if (!ciphertext || !iv || !tag || iv.length !== 12 || tag.length !== 16) {
    throw new DatabaseError('Failed to map transaction row');
  }

  return Object.freeze({
    id: row['id'],
    keyVersion: row['key_version'],
    returnTo: row['return_to'],
    secretsCiphertext: ciphertext,
    secretsIv: iv,
    secretsAuthTag: tag,
    createdAt: parseIsoTimestamp(row['created_at']),
    expiresAt: parseIsoTimestamp(row['expires_at']),
  });
}

export interface ApplicationSessionRow {
  readonly id: string;
  readonly userId: string;
  readonly currentTokenHash: Uint8Array | null;
  readonly previousTokenHash: Uint8Array | null;
  readonly previousTokenValidUntil: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly lastSeenAt: IsoTimestamp;
  readonly idleExpiresAt: IsoTimestamp;
  readonly absoluteExpiresAt: IsoTimestamp;
  readonly rotatedAt: IsoTimestamp;
  readonly revokedAt: IsoTimestamp | null;
  readonly revocationReason: string | null;
  readonly version: number;
}

export function mapSessionRow(rawRow: unknown): ApplicationSessionRow {
  if (typeof rawRow !== 'object' || rawRow === null || isProxySafe(rawRow)) {
    throw new DatabaseError('Failed to map session row');
  }
  const proto = Object.getPrototypeOf(rawRow);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Failed to map session row');
  }
  const row = rawRow as Record<string, unknown>;

  if (typeof row['id'] !== 'string' || !isValidUuidV7(row['id'])) {
    throw new DatabaseError('Failed to map session row');
  }
  if (typeof row['user_id'] !== 'string' || !isValidUuidV7(row['user_id'])) {
    throw new DatabaseError('Failed to map session row');
  }

  const currentTokenHash = copyBytes(row['current_token_hash']);
  const previousTokenHash = copyBytes(row['previous_token_hash']);
  if (currentTokenHash && currentTokenHash.length !== 32) {
    throw new DatabaseError('Failed to map session row');
  }
  if (previousTokenHash && previousTokenHash.length !== 32) {
    throw new DatabaseError('Failed to map session row');
  }

  const prevValidUntil = row['previous_token_valid_until']
    ? parseIsoTimestamp(row['previous_token_valid_until'])
    : null;

  const revokedAt = row['revoked_at'] ? parseIsoTimestamp(row['revoked_at']) : null;
  const revocationReason =
    typeof row['revocation_reason'] === 'string' ? row['revocation_reason'] : null;

  return Object.freeze({
    id: row['id'],
    userId: row['user_id'],
    currentTokenHash,
    previousTokenHash,
    previousTokenValidUntil: prevValidUntil,
    createdAt: parseIsoTimestamp(row['created_at']),
    lastSeenAt: parseIsoTimestamp(row['last_seen_at']),
    idleExpiresAt: parseIsoTimestamp(row['idle_expires_at']),
    absoluteExpiresAt: parseIsoTimestamp(row['absolute_expires_at']),
    rotatedAt: parseIsoTimestamp(row['rotated_at']),
    revokedAt,
    revocationReason,
    version: parseVersion(row['version']),
  });
}

export interface WorkspaceSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly role: 'owner' | 'editor' | 'viewer';
}

export function mapWorkspaceSummaryRow(rawRow: unknown): WorkspaceSummaryRow {
  if (typeof rawRow !== 'object' || rawRow === null || isProxySafe(rawRow)) {
    throw new DatabaseError('Failed to map workspace summary row');
  }
  const proto = Object.getPrototypeOf(rawRow);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Failed to map workspace summary row');
  }
  const row = rawRow as Record<string, unknown>;

  if (typeof row['id'] !== 'string' || !isValidUuidV7(row['id'])) {
    throw new DatabaseError('Failed to map workspace summary row');
  }
  if (typeof row['name'] !== 'string' || row['name'].trim() === '') {
    throw new DatabaseError('Failed to map workspace summary row');
  }
  if (typeof row['slug'] !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row['slug'])) {
    throw new DatabaseError('Failed to map workspace summary row');
  }
  if (typeof row['timezone'] !== 'string' || row['timezone'].trim() === '') {
    throw new DatabaseError('Failed to map workspace summary row');
  }
  const role = row['role'];
  if (role !== 'owner' && role !== 'editor' && role !== 'viewer') {
    throw new DatabaseError('Failed to map workspace summary row');
  }

  return Object.freeze({
    id: row['id'],
    name: row['name'],
    slug: row['slug'],
    timezone: row['timezone'],
    role,
  });
}
