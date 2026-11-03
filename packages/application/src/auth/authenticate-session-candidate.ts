import util from 'node:util';
import type { UserSnapshot } from '@affiliate-content-os/domain';
import { AuthenticationRequiredError } from './errors.js';
import type { SessionSnapshotDTO } from './ports.js';

export function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

export function copyBytes(val: unknown): Uint8Array | null {
  if (val === null) return null;
  if (!(val instanceof Uint8Array) || isProxySafe(val)) return null;
  const copy = new Uint8Array(val.byteLength);
  copy.set(val);
  return copy;
}

export function bytesEqual(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function validateSessionCookie(cookie: unknown): string {
  if (
    typeof cookie !== 'string' ||
    cookie.length !== 43 ||
    cookie.includes('=') ||
    !/^[A-Za-z0-9_-]{43}$/.test(cookie)
  ) {
    throw new AuthenticationRequiredError();
  }
  return cookie;
}

function getOwnDataProp(obj: object, prop: string): unknown | undefined {
  const desc = Object.getOwnPropertyDescriptor(obj, prop);
  if (!desc || desc.get !== undefined || desc.set !== undefined) {
    return undefined;
  }
  return desc.value;
}

export function extractSingleCandidate(candidates: unknown): SessionSnapshotDTO | null {
  if (typeof candidates !== 'object' || candidates === null || isProxySafe(candidates)) {
    return null;
  }
  if (!Array.isArray(candidates) || Object.getPrototypeOf(candidates) !== Array.prototype) {
    return null;
  }
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

export function safeExtractUser(user: unknown): UserSnapshot | null {
  if (typeof user !== 'object' || user === null || isProxySafe(user)) {
    return null;
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
  return user as UserSnapshot;
}
