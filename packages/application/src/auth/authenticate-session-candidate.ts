import type { UserSnapshot } from '@affiliate-content-os/domain';
import type { SessionSnapshotDTO } from './ports.js';
import {
  bytesEqual,
  copyBytes,
  isProxySafe,
  validateSessionCookie,
} from './byte-snapshot-helpers.js';

export { bytesEqual, copyBytes, isProxySafe, validateSessionCookie };

function isValidUuidV7(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(val);
}

function isValidIsoTimestamp(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(val)) return false;
  const t = Date.parse(val);
  return Number.isFinite(t) && new Date(t).toISOString() === val;
}

const ALLOWED_CANDIDATE_KEYS = new Set([
  'id',
  'userId',
  'currentTokenHash',
  'previousTokenHash',
  'previousTokenValidUntil',
  'createdAt',
  'lastSeenAt',
  'idleExpiresAt',
  'absoluteExpiresAt',
  'rotatedAt',
  'revokedAt',
  'revocationReason',
  'version',
]);

const ALLOWED_REVOCATION_REASONS = new Set([
  'user_requested',
  'user_logged_out',
  'user_unavailable',
  'idle_expired',
  'absolute_expired',
]);

export function extractSingleCandidate(
  candidates: unknown,
  nowIso?: string,
): SessionSnapshotDTO | null {
  if (typeof candidates !== 'object' || candidates === null || isProxySafe(candidates)) {
    return null;
  }
  if (!Array.isArray(candidates) || Object.getPrototypeOf(candidates) !== Array.prototype) {
    return null;
  }
  const candKeys = Reflect.ownKeys(candidates);
  if (candKeys.length !== 2) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(candidates, 'length');
  if (!lenDesc || lenDesc.get !== undefined || lenDesc.set !== undefined || lenDesc.value !== 1) {
    return null;
  }
  const desc0 = Object.getOwnPropertyDescriptor(candidates, '0');
  if (!desc0 || desc0.get !== undefined || desc0.set !== undefined) {
    return null;
  }
  const raw = desc0.value;
  if (typeof raw !== 'object' || raw === null || isProxySafe(raw)) {
    return null;
  }
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  const rawKeys = Reflect.ownKeys(raw);
  if (rawKeys.length !== ALLOWED_CANDIDATE_KEYS.size) {
    return null;
  }
  for (const k of rawKeys) {
    if (typeof k !== 'string' || !ALLOWED_CANDIDATE_KEYS.has(k)) {
      return null;
    }
  }

  const descriptors: Record<string, PropertyDescriptor | undefined> = Object.create(null);
  for (const k of ALLOWED_CANDIDATE_KEYS) {
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (!d || d.get !== undefined || d.set !== undefined) {
      return null;
    }
    descriptors[k] = d;
  }

  const id = descriptors['id']!.value;
  const userId = descriptors['userId']!.value;
  const rawCurrentHash = descriptors['currentTokenHash']!.value;
  const rawPreviousHash = descriptors['previousTokenHash']!.value;
  const rawPrevValidUntil = descriptors['previousTokenValidUntil']!.value;
  const createdAt = descriptors['createdAt']!.value;
  const lastSeenAt = descriptors['lastSeenAt']!.value;
  const idleExpiresAt = descriptors['idleExpiresAt']!.value;
  const absoluteExpiresAt = descriptors['absoluteExpiresAt']!.value;
  const rotatedAt = descriptors['rotatedAt']!.value;
  const revokedAt = descriptors['revokedAt']!.value;
  const revocationReason = descriptors['revocationReason']!.value;
  const version = descriptors['version']!.value;

  if (
    typeof id !== 'string' ||
    !isValidUuidV7(id) ||
    typeof userId !== 'string' ||
    !isValidUuidV7(userId) ||
    typeof createdAt !== 'string' ||
    !isValidIsoTimestamp(createdAt) ||
    typeof lastSeenAt !== 'string' ||
    !isValidIsoTimestamp(lastSeenAt) ||
    typeof idleExpiresAt !== 'string' ||
    !isValidIsoTimestamp(idleExpiresAt) ||
    typeof absoluteExpiresAt !== 'string' ||
    !isValidIsoTimestamp(absoluteExpiresAt) ||
    typeof rotatedAt !== 'string' ||
    !isValidIsoTimestamp(rotatedAt) ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return null;
  }

  if (revokedAt !== null && (typeof revokedAt !== 'string' || !isValidIsoTimestamp(revokedAt))) {
    return null;
  }
  if (
    revocationReason !== null &&
    (typeof revocationReason !== 'string' || !ALLOWED_REVOCATION_REASONS.has(revocationReason))
  ) {
    return null;
  }
  if (
    rawPrevValidUntil !== null &&
    (typeof rawPrevValidUntil !== 'string' || !isValidIsoTimestamp(rawPrevValidUntil))
  ) {
    return null;
  }

  // Active authenticatable candidate must have null revocation fields
  if (revokedAt !== null || revocationReason !== null) {
    return null;
  }

  const currentTokenHash = copyBytes(rawCurrentHash);
  if (!currentTokenHash || currentTokenHash.length !== 32) {
    return null;
  }

  let previousTokenHash: Uint8Array | null = null;
  if (rawPreviousHash !== null) {
    previousTokenHash = copyBytes(rawPreviousHash);
    if (!previousTokenHash || previousTokenHash.length !== 32) {
      return null;
    }
  }

  // Previous hash and previous valid until must be both null or both non-null
  if (
    (previousTokenHash === null && rawPrevValidUntil !== null) ||
    (previousTokenHash !== null && rawPrevValidUntil === null)
  ) {
    return null;
  }

  // Current and previous hashes must differ
  if (previousTokenHash !== null && bytesEqual(currentTokenHash, previousTokenHash)) {
    return null;
  }

  // Timestamp ordering invariants from spec Section 3.2:
  // createdAt <= lastSeenAt
  // createdAt <= rotatedAt
  // createdAt <= idleExpiresAt
  // createdAt <= absoluteExpiresAt
  if (
    createdAt > lastSeenAt ||
    createdAt > rotatedAt ||
    createdAt > idleExpiresAt ||
    createdAt > absoluteExpiresAt
  ) {
    return null;
  }

  // idleExpiresAt <= absoluteExpiresAt (if not already past absolute expiry)
  if (idleExpiresAt > absoluteExpiresAt) {
    if (!nowIso || nowIso < absoluteExpiresAt) {
      return null;
    }
  }

  // When previous-token fields present: rotatedAt <= previousTokenValidUntil <= absoluteExpiresAt
  if (rawPrevValidUntil !== null) {
    if (rotatedAt > rawPrevValidUntil || rawPrevValidUntil > absoluteExpiresAt) {
      return null;
    }
  }

  return Object.freeze({
    id,
    userId,
    currentTokenHash,
    previousTokenHash,
    previousTokenValidUntil: rawPrevValidUntil as string | null,
    createdAt,
    lastSeenAt,
    idleExpiresAt,
    absoluteExpiresAt,
    rotatedAt,
    revokedAt: null,
    revocationReason: null,
    version,
  });
}

const ALLOWED_USER_KEYS = new Set([
  'id',
  'identityProvider',
  'identitySubject',
  'email',
  'displayName',
  'status',
  'createdAt',
  'updatedAt',
  'version',
]);

export function safeExtractUser(user: unknown): UserSnapshot | null {
  if (typeof user !== 'object' || user === null || isProxySafe(user)) {
    return null;
  }
  const proto = Object.getPrototypeOf(user);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  const userKeys = Reflect.ownKeys(user);
  if (userKeys.length !== ALLOWED_USER_KEYS.size) {
    return null;
  }
  for (const k of userKeys) {
    if (typeof k !== 'string' || !ALLOWED_USER_KEYS.has(k)) {
      return null;
    }
  }

  const descriptors: Record<string, PropertyDescriptor | undefined> = Object.create(null);
  for (const k of ALLOWED_USER_KEYS) {
    const d = Object.getOwnPropertyDescriptor(user, k);
    if (!d || d.get !== undefined || d.set !== undefined) {
      return null;
    }
    descriptors[k] = d;
  }

  const id = descriptors['id']!.value;
  const identityProvider = descriptors['identityProvider']!.value;
  const identitySubject = descriptors['identitySubject']!.value;
  const email = descriptors['email']!.value;
  const displayName = descriptors['displayName']!.value;
  const status = descriptors['status']!.value;
  const createdAt = descriptors['createdAt']!.value;
  const updatedAt = descriptors['updatedAt']!.value;
  const version = descriptors['version']!.value;

  if (
    typeof id !== 'string' ||
    !isValidUuidV7(id) ||
    typeof identityProvider !== 'string' ||
    identityProvider.length === 0 ||
    identityProvider.trim() !== identityProvider ||
    typeof identitySubject !== 'string' ||
    identitySubject.length === 0 ||
    identitySubject.trim() !== identitySubject ||
    status !== 'active' ||
    typeof createdAt !== 'string' ||
    !isValidIsoTimestamp(createdAt) ||
    typeof updatedAt !== 'string' ||
    !isValidIsoTimestamp(updatedAt) ||
    createdAt > updatedAt ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return null;
  }

  if (email !== null && typeof email !== 'string') {
    return null;
  }
  if (displayName !== null && typeof displayName !== 'string') {
    return null;
  }

  // MUST return a newly allocated frozen plain object populated only from validated descriptors
  return Object.freeze({
    id,
    identityProvider,
    identitySubject,
    email,
    displayName,
    status,
    createdAt,
    updatedAt,
    version,
  }) as UserSnapshot;
}
