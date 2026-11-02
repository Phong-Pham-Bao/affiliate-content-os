import util from 'node:util';
import { parseUserId, type UserSnapshot } from '@affiliate-content-os/domain';
import type { UserDirectoryPort } from '../ports.js';
import { AuthenticationRequiredError } from './errors.js';
import type { AuthCryptoPort, SessionSnapshotDTO, SessionStorePort } from './ports.js';

export interface AuthenticateSessionCommand {
  readonly sessionCookie: unknown;
}

export interface AuthenticateSessionDependencies {
  readonly crypto: AuthCryptoPort;
  readonly sessionStore: SessionStorePort;
  readonly userDirectory: UserDirectoryPort;
  readonly now: () => Date;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionRotationSeconds: number;
  readonly sessionRotationGraceSeconds: number;
  readonly sessionTouchIntervalSeconds: number;
}

export interface AuthenticatedSessionContext {
  readonly user: UserSnapshot;
  readonly session: {
    readonly id: string;
    readonly userId: string;
    readonly idleExpiresAt: string;
    readonly absoluteExpiresAt: string;
  };
  readonly rotatedToken: string | null;
}

function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

function bytesEqual(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function validateSessionCookie(cookie: unknown): string {
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

function extractSingleCandidate(candidates: unknown): SessionSnapshotDTO | null {
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
  const s = desc0.value;
  if (typeof s !== 'object' || s === null || isProxySafe(s)) {
    return null;
  }
  return s as SessionSnapshotDTO;
}

export async function authenticateApplicationSession(
  command: AuthenticateSessionCommand,
  deps: AuthenticateSessionDependencies,
): Promise<AuthenticatedSessionContext> {
  const cookie = validateSessionCookie(command.sessionCookie);
  const tokenHash = deps.crypto.hashToken(cookie);
  const currentInstant = deps.now();
  const nowMs = currentInstant.getTime();
  const nowIso = currentInstant.toISOString();

  type AuthOutcome =
    | { readonly status: 'unauthenticated' }
    | { readonly status: 'authenticated'; readonly context: AuthenticatedSessionContext };

  const outcome: AuthOutcome = await deps.sessionStore.withTransaction(async (txStore) => {
    const store = txStore ?? deps.sessionStore;
    const rawCandidates = await store.findCandidateSessions({
      tokenHash,
      now: nowIso,
    });

    const s = extractSingleCandidate(rawCandidates);
    if (!s || s.revokedAt !== null) {
      return { status: 'unauthenticated' };
    }

    const absExpiresMs = new Date(s.absoluteExpiresAt).getTime();
    if (nowMs >= absExpiresMs) {
      await store.revokeSession({
        sessionId: s.id,
        currentVersion: s.version,
        revokedAt: nowIso,
        reason: 'absolute_expired',
      });
      return { status: 'unauthenticated' };
    }

    const idleExpiresMs = new Date(s.idleExpiresAt).getTime();
    if (nowMs >= idleExpiresMs) {
      await store.revokeSession({
        sessionId: s.id,
        currentVersion: s.version,
        revokedAt: nowIso,
        reason: 'idle_expired',
      });
      return { status: 'unauthenticated' };
    }

    let parsedUserId;
    try {
      parsedUserId = parseUserId(s.userId);
    } catch {
      return { status: 'unauthenticated' };
    }

    const user = await deps.userDirectory.findUserById(parsedUserId);
    if (!user || user.status !== 'active') {
      await store.revokeSession({
        sessionId: s.id,
        currentVersion: s.version,
        revokedAt: nowIso,
        reason: 'user_unavailable',
      });
      return { status: 'unauthenticated' };
    }

    const isCurrentToken = bytesEqual(s.currentTokenHash, tokenHash);
    const isPreviousToken = bytesEqual(s.previousTokenHash, tokenHash);

    if (!isCurrentToken && !isPreviousToken) {
      return { status: 'unauthenticated' };
    }

    let rotatedToken: string | null = null;
    let effectiveIdleExpiresAt = s.idleExpiresAt;

    if (isCurrentToken) {
      const rotatedAtMs = new Date(s.rotatedAt).getTime();
      const shouldRotate = nowMs >= rotatedAtMs + deps.sessionRotationSeconds * 1000;

      if (shouldRotate) {
        const newToken = deps.crypto.generateRandomToken();
        const newHash = deps.crypto.hashToken(newToken);
        const graceMs = Math.min(nowMs + deps.sessionRotationGraceSeconds * 1000, absExpiresMs);
        const newIdleMs = Math.min(nowMs + deps.sessionIdleTtlSeconds * 1000, absExpiresMs);
        effectiveIdleExpiresAt = new Date(newIdleMs).toISOString();

        await store.rotateSession({
          sessionId: s.id,
          currentVersion: s.version,
          newCurrentHash: newHash,
          oldCurrentHash: s.currentTokenHash!,
          graceValidUntil: new Date(graceMs).toISOString(),
          rotatedAt: nowIso,
          lastSeenAt: nowIso,
          idleExpiresAt: effectiveIdleExpiresAt,
        });

        rotatedToken = newToken;
      } else {
        const lastSeenMs = new Date(s.lastSeenAt).getTime();
        const shouldTouch = nowMs >= lastSeenMs + deps.sessionTouchIntervalSeconds * 1000;

        if (shouldTouch) {
          const newIdleMs = Math.min(nowMs + deps.sessionIdleTtlSeconds * 1000, absExpiresMs);
          effectiveIdleExpiresAt = new Date(newIdleMs).toISOString();

          await store.touchSession({
            sessionId: s.id,
            currentVersion: s.version,
            lastSeenAt: nowIso,
            idleExpiresAt: effectiveIdleExpiresAt,
          });
        }
      }
    } else {
      if (!s.previousTokenValidUntil || nowMs > new Date(s.previousTokenValidUntil).getTime()) {
        return { status: 'unauthenticated' };
      }
    }

    return {
      status: 'authenticated',
      context: Object.freeze({
        user,
        session: Object.freeze({
          id: s.id,
          userId: s.userId,
          idleExpiresAt: effectiveIdleExpiresAt,
          absoluteExpiresAt: s.absoluteExpiresAt,
        }),
        rotatedToken,
      }),
    };
  });

  if (outcome.status === 'unauthenticated') {
    throw new AuthenticationRequiredError();
  }

  return outcome.context;
}
