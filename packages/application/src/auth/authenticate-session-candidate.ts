import type { UserSnapshot } from '@affiliate-content-os/domain';
import type { SessionSnapshotDTO } from './ports.js';
import {
  copyBytes,
  isProxySafe,
  bytesEqual,
  validateSessionCookie,
} from './byte-snapshot-helpers.js';

export { copyBytes, isProxySafe, bytesEqual, validateSessionCookie };

function getOwnDataProp(obj: object, prop: string): unknown | undefined {
  const desc = Object.getOwnPropertyDescriptor(obj, prop);
  if (!desc || desc.get !== undefined || desc.set !== undefined) {
    return undefined;
  }
  return desc.value;
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

export function extractSingleCandidate(candidates: unknown): SessionSnapshotDTO | null {
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

  const id = getOwnDataProp(raw, 'id');
  const userId = getOwnDataProp(raw, 'userId');
  const rawCurrentHash = getOwnDataProp(raw, 'currentTokenHash');
  const rawPreviousHash = getOwnDataProp(raw, 'previousTokenHash');
  const rawPrevValidUntil = getOwnDataProp(raw, 'previousTokenValidUntil');
  const createdAt = getOwnDataProp(raw, 'createdAt');
  const lastSeenAt = getOwnDataProp(raw, 'lastSeenAt');
  const idleExpiresAt = getOwnDataProp(raw, 'idleExpiresAt');
  const absoluteExpiresAt = getOwnDataProp(raw, 'absoluteExpiresAt');
  const rotatedAt = getOwnDataProp(raw, 'rotatedAt');
  const revokedAt = getOwnDataProp(raw, 'revokedAt');
  const revocationReason = getOwnDataProp(raw, 'revocationReason');
  const version = getOwnDataProp(raw, 'version');

  if (
    typeof id !== 'string' ||
    typeof userId !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof lastSeenAt !== 'string' ||
    typeof idleExpiresAt !== 'string' ||
    typeof absoluteExpiresAt !== 'string' ||
    typeof rotatedAt !== 'string' ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return null;
  }
  if (revokedAt !== null && typeof revokedAt !== 'string') return null;
  if (revocationReason !== null && typeof revocationReason !== 'string') return null;
  if (rawPrevValidUntil !== null && typeof rawPrevValidUntil !== 'string') return null;

  let currentTokenHash: Uint8Array | null = null;
  if (rawCurrentHash !== null) {
    currentTokenHash = copyBytes(rawCurrentHash);
    if (!currentTokenHash || currentTokenHash.length !== 32) return null;
  }

  let previousTokenHash: Uint8Array | null = null;
  if (rawPreviousHash !== null) {
    previousTokenHash = copyBytes(rawPreviousHash);
    if (!previousTokenHash || previousTokenHash.length !== 32) return null;
  }

  return Object.freeze({
    id,
    userId,
    currentTokenHash,
    previousTokenHash,
    previousTokenValidUntil: (rawPrevValidUntil as string | null) ?? null,
    createdAt,
    lastSeenAt,
    idleExpiresAt,
    absoluteExpiresAt,
    rotatedAt,
    revokedAt: (revokedAt as string | null) ?? null,
    revocationReason: (revocationReason as string | null) ?? null,
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
  const statusDesc = Object.getOwnPropertyDescriptor(user, 'status');
  if (
    !statusDesc ||
    statusDesc.get !== undefined ||
    statusDesc.set !== undefined ||
    statusDesc.value !== 'active'
  ) {
    return null;
  }
  for (const prop of ['id', 'identityProvider', 'identitySubject', 'createdAt', 'updatedAt']) {
    const d = Object.getOwnPropertyDescriptor(user, prop);
    if (!d || d.get !== undefined || d.set !== undefined || typeof d.value !== 'string') {
      return null;
    }
  }
  for (const prop of ['email', 'displayName']) {
    const d = Object.getOwnPropertyDescriptor(user, prop);
    if (!d || d.get !== undefined || d.set !== undefined) return null;
    if (d.value !== null && typeof d.value !== 'string') return null;
  }
  const vDesc = Object.getOwnPropertyDescriptor(user, 'version');
  if (
    !vDesc ||
    vDesc.get !== undefined ||
    vDesc.set !== undefined ||
    typeof vDesc.value !== 'number' ||
    !Number.isSafeInteger(vDesc.value) ||
    vDesc.value < 1
  ) {
    return null;
  }
  return user as UserSnapshot;
}
