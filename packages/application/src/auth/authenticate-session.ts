import { parseUserId } from '@affiliate-content-os/domain';
import { AuthenticationRequiredError } from './errors.js';
import type {
  AuthenticateSessionCommand,
  AuthenticateSessionDependencies,
  AuthenticatedSessionContext,
} from './authenticate-session-types.js';
import {
  bytesEqual,
  extractSingleCandidate,
  safeExtractUser,
  validateSessionCookie,
} from './authenticate-session-candidate.js';

export type {
  AuthenticateSessionCommand,
  AuthenticateSessionDependencies,
  AuthenticatedSessionContext,
} from './authenticate-session-types.js';

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

    const rawUser = store.findUserById
      ? await store.findUserById(parsedUserId)
      : await deps.userDirectory?.findUserById(parsedUserId);

    const user = safeExtractUser(rawUser);
    if (!user) {
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
