import { isValidUuidV7, type IsoTimestamp } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { copyBytes, isProxySafe, parseIsoTimestamp, parseVersion } from './mapper-helpers.js';

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

const REQUIRED_SESSION_ROW_KEYS = [
  'id',
  'user_id',
  'current_token_hash',
  'previous_token_hash',
  'previous_token_valid_until',
  'created_at',
  'last_seen_at',
  'idle_expires_at',
  'absolute_expires_at',
  'rotated_at',
  'revoked_at',
  'revocation_reason',
  'version',
] as const;

const ALLOWED_REVOCATION_REASONS = new Set([
  'logout',
  'user_unavailable',
  'idle_expired',
  'absolute_expired',
]);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function mapSessionRow(rawRow: unknown): ApplicationSessionRow {
  if (typeof rawRow !== 'object' || rawRow === null || isProxySafe(rawRow)) {
    throw new DatabaseError('Failed to map session row');
  }
  const proto = Object.getPrototypeOf(rawRow);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Failed to map session row');
  }

  const ownKeys = Reflect.ownKeys(rawRow);
  if (ownKeys.length !== REQUIRED_SESSION_ROW_KEYS.length) {
    throw new DatabaseError('Failed to map session row');
  }

  const values: Record<string, unknown> = Object.create(null);
  for (const key of REQUIRED_SESSION_ROW_KEYS) {
    const desc = Object.getOwnPropertyDescriptor(rawRow, key);
    if (!desc || desc.get !== undefined || desc.set !== undefined) {
      throw new DatabaseError('Failed to map session row');
    }
    values[key] = desc.value;
  }

  const id = values['id'];
  if (typeof id !== 'string' || !isValidUuidV7(id)) {
    throw new DatabaseError('Failed to map session row');
  }

  const userId = values['user_id'];
  if (typeof userId !== 'string' || !isValidUuidV7(userId)) {
    throw new DatabaseError('Failed to map session row');
  }

  const currentTokenHash = copyBytes(values['current_token_hash']);
  const previousTokenHash = copyBytes(values['previous_token_hash']);
  if (currentTokenHash && currentTokenHash.length !== 32) {
    throw new DatabaseError('Failed to map session row');
  }
  if (previousTokenHash && previousTokenHash.length !== 32) {
    throw new DatabaseError('Failed to map session row');
  }

  const prevValidUntilVal = values['previous_token_valid_until'];
  const prevValidUntil =
    prevValidUntilVal !== null && prevValidUntilVal !== undefined
      ? parseIsoTimestamp(prevValidUntilVal)
      : null;

  const revokedAtVal = values['revoked_at'];
  const revokedAt =
    revokedAtVal !== null && revokedAtVal !== undefined ? parseIsoTimestamp(revokedAtVal) : null;

  const revocationReasonVal = values['revocation_reason'];
  const revocationReason = typeof revocationReasonVal === 'string' ? revocationReasonVal : null;

  const createdAt = parseIsoTimestamp(values['created_at']);
  const lastSeenAt = parseIsoTimestamp(values['last_seen_at']);
  const idleExpiresAt = parseIsoTimestamp(values['idle_expires_at']);
  const absoluteExpiresAt = parseIsoTimestamp(values['absolute_expires_at']);
  const rotatedAt = parseIsoTimestamp(values['rotated_at']);

  const createdMs = new Date(createdAt).getTime();
  const lastSeenMs = new Date(lastSeenAt).getTime();
  const idleExpiresMs = new Date(idleExpiresAt).getTime();
  const absExpiresMs = new Date(absoluteExpiresAt).getTime();
  const rotatedMs = new Date(rotatedAt).getTime();

  // Timestamp invariants: absolute_expires_at >= idle_expires_at >= last_seen_at >= rotated_at >= created_at
  if (
    rotatedMs < createdMs ||
    lastSeenMs < rotatedMs ||
    idleExpiresMs < lastSeenMs ||
    absExpiresMs < idleExpiresMs ||
    absExpiresMs <= createdMs
  ) {
    throw new DatabaseError('Session timestamps invariant violation');
  }

  if (prevValidUntil !== null) {
    const prevValidMs = new Date(prevValidUntil).getTime();
    if (prevValidMs < rotatedMs || prevValidMs > absExpiresMs) {
      throw new DatabaseError('Session grace timestamp invariant violation');
    }
  }

  if (revokedAt !== null) {
    const revokedMs = new Date(revokedAt).getTime();
    if (revokedMs < createdMs) {
      throw new DatabaseError('Session revoked timestamp invariant violation');
    }
    if (
      !revocationReason ||
      !ALLOWED_REVOCATION_REASONS.has(revocationReason) ||
      currentTokenHash !== null ||
      previousTokenHash !== null ||
      prevValidUntil !== null
    ) {
      throw new DatabaseError('Revoked session lifecycle invariant violation');
    }
  } else {
    if (
      revocationReason !== null ||
      currentTokenHash === null ||
      (previousTokenHash !== null &&
        (prevValidUntil === null || bytesEqual(currentTokenHash, previousTokenHash))) ||
      (previousTokenHash === null && prevValidUntil !== null)
    ) {
      throw new DatabaseError('Active session lifecycle invariant violation');
    }
  }

  return Object.freeze({
    id,
    userId,
    currentTokenHash,
    previousTokenHash,
    previousTokenValidUntil: prevValidUntil,
    createdAt,
    lastSeenAt,
    idleExpiresAt,
    absoluteExpiresAt,
    rotatedAt,
    revokedAt,
    revocationReason,
    version: parseVersion(values['version']),
  });
}
