import type { UserSnapshot } from '@affiliate-content-os/domain';
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

export async function authenticateApplicationSession(
  command: AuthenticateSessionCommand,
  deps: AuthenticateSessionDependencies,
): Promise<AuthenticatedSessionContext> {
  const cookie = validateSessionCookie(command.sessionCookie);
  const tokenHash = deps.crypto.hashToken(cookie);
  const currentInstant = deps.now();
  const nowMs = currentInstant.getTime();
  const nowIso = currentInstant.toISOString();

  const candidates: readonly SessionSnapshotDTO[] = await deps.sessionStore.findCandidateSessions({
    tokenHash,
    now: nowIso,
  });

  if (!Array.isArray(candidates) || candidates.length !== 1) {
    throw new AuthenticationRequiredError();
  }

  const s = candidates[0]!;
  if (s.revokedAt !== null) {
    throw new AuthenticationRequiredError();
  }

  const absExpiresMs = new Date(s.absoluteExpiresAt).getTime();
  if (nowMs >= absExpiresMs) {
    await deps.sessionStore.revokeSession({
      sessionId: s.id,
      currentVersion: s.version,
      revokedAt: nowIso,
      reason: 'absolute_expired',
    });
    throw new AuthenticationRequiredError();
  }

  const idleExpiresMs = new Date(s.idleExpiresAt).getTime();
  if (nowMs >= idleExpiresMs) {
    await deps.sessionStore.revokeSession({
      sessionId: s.id,
      currentVersion: s.version,
      revokedAt: nowIso,
      reason: 'idle_expired',
    });
    throw new AuthenticationRequiredError();
  }

  const user = await deps.userDirectory.findUserById(s.userId);
  if (!user || user.status !== 'active') {
    await deps.sessionStore.revokeSession({
      sessionId: s.id,
      currentVersion: s.version,
      revokedAt: nowIso,
      reason: 'user_unavailable',
    });
    throw new AuthenticationRequiredError();
  }

  const isCurrentToken = bytesEqual(s.currentTokenHash, tokenHash);
  const isPreviousToken = bytesEqual(s.previousTokenHash, tokenHash);

  if (!isCurrentToken && !isPreviousToken) {
    throw new AuthenticationRequiredError();
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

      await deps.sessionStore.rotateSession({
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

        await deps.sessionStore.touchSession({
          sessionId: s.id,
          currentVersion: s.version,
          lastSeenAt: nowIso,
          idleExpiresAt: effectiveIdleExpiresAt,
        });
      }
    }
  } else {
    // Previous token during grace: do not rotate, verify grace expiry
    if (!s.previousTokenValidUntil || nowMs > new Date(s.previousTokenValidUntil).getTime()) {
      throw new AuthenticationRequiredError();
    }
  }

  return Object.freeze({
    user,
    session: Object.freeze({
      id: s.id,
      userId: s.userId,
      idleExpiresAt: effectiveIdleExpiresAt,
      absoluteExpiresAt: s.absoluteExpiresAt,
    }),
    rotatedToken,
  });
}
