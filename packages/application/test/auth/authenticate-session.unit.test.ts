import { describe, expect, it, vi } from 'vitest';
import { authenticateApplicationSession } from '../../src/auth/authenticate-session.js';
import { AuthenticationRequiredError } from '../../src/auth/errors.js';
import type { AuthCryptoPort, SessionSnapshotDTO, SessionStorePort } from '../../src/auth/ports.js';

describe('packages/application - authenticateApplicationSession', () => {
  const sampleNow = new Date('2026-11-02T12:00:00.000Z');
  const sampleSessionId = '0192b012-3456-789a-8bcd-ef0123456720';
  const sampleUserId = '0192b012-3456-789a-8bcd-ef0123456710';
  const validCookie = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const cookieHash = new Uint8Array(32).fill(1);

  function createActiveSessionSnapshot(
    overrides?: Partial<SessionSnapshotDTO>,
  ): SessionSnapshotDTO {
    return {
      id: sampleSessionId,
      userId: sampleUserId,
      currentTokenHash: cookieHash,
      previousTokenHash: null,
      previousTokenValidUntil: null,
      createdAt: '2026-11-02T11:00:00.000Z',
      lastSeenAt: '2026-11-02T11:58:00.000Z',
      idleExpiresAt: '2026-11-02T12:28:00.000Z',
      absoluteExpiresAt: '2026-11-02T19:00:00.000Z',
      rotatedAt: '2026-11-02T11:50:00.000Z',
      revokedAt: null,
      revocationReason: null,
      version: 1,
      ...overrides,
    };
  }

  function createFakes(sessionRow = createActiveSessionSnapshot()): {
    crypto: AuthCryptoPort;
    sessionStore: SessionStorePort;
  } {
    return {
      crypto: {
        generateRandomToken: vi.fn().mockReturnValue('new-rotated-token-32-bytes-base64url-val'),
        hashToken: vi.fn().mockReturnValue(cookieHash),
        generateState: vi.fn(),
        generateBrowserBinding: vi.fn(),
        generateNonce: vi.fn(),
        generatePkce: vi.fn(),
        encryptSecrets: vi.fn(),
        decryptSecrets: vi.fn(),
      },
      sessionStore: {
        createSession: vi.fn(),
        findCandidateSessions: vi.fn().mockResolvedValue([sessionRow]),
        findUserById: vi.fn().mockResolvedValue({
          id: sampleUserId,
          identityProvider: 'https://auth.example.com',
          identitySubject: 'sub-1',
          email: 'u@ex.com',
          displayName: 'User',
          status: 'active',
          createdAt: '2026-11-02T11:00:00.000Z',
          updatedAt: '2026-11-02T11:00:00.000Z',
          version: 1,
        }),
        rotateSession: vi.fn().mockResolvedValue(undefined),
        touchSession: vi.fn().mockResolvedValue(undefined),
        revokeSession: vi.fn().mockResolvedValue(undefined),
        revokeMatchingSessionsByTokenHash: vi.fn(),
        withTransaction: vi.fn(async function <T>(
          this: SessionStorePort,
          fn: (txStore: SessionStorePort) => Promise<T>,
        ): Promise<T> {
          return fn(this);
        }) as unknown as SessionStorePort['withTransaction'],
      },
    };
  }

  it('rejects malformed session cookie before database lookup', async () => {
    const fakes = createFakes();
    await expect(
      authenticateApplicationSession(
        { sessionCookie: 'bad' },
        {
          ...fakes,
          now: () => sampleNow,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ).rejects.toThrow(AuthenticationRequiredError);

    expect(fakes.sessionStore.findCandidateSessions).not.toHaveBeenCalled();
  });

  it('fails closed when candidate sessions count is 0', async () => {
    const fakes = createFakes();
    (fakes.sessionStore.findCandidateSessions as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      [],
    );

    await expect(
      authenticateApplicationSession(
        { sessionCookie: validCookie },
        {
          ...fakes,
          now: () => sampleNow,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ).rejects.toThrow(AuthenticationRequiredError);
  });

  it('revokes session on absolute expiry', async () => {
    const expiredSession = createActiveSessionSnapshot({
      absoluteExpiresAt: '2026-11-02T11:59:00.000Z',
    });
    const fakes = createFakes(expiredSession);

    await expect(
      authenticateApplicationSession(
        { sessionCookie: validCookie },
        {
          ...fakes,
          now: () => sampleNow,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ).rejects.toThrow(AuthenticationRequiredError);

    expect(fakes.sessionStore.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'absolute_expired' }),
    );
  });

  it('revokes session on idle expiry', async () => {
    const idleExpiredSession = createActiveSessionSnapshot({
      idleExpiresAt: '2026-11-02T11:59:00.000Z',
    });
    const fakes = createFakes(idleExpiredSession);

    await expect(
      authenticateApplicationSession(
        { sessionCookie: validCookie },
        {
          ...fakes,
          now: () => sampleNow,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ).rejects.toThrow(AuthenticationRequiredError);

    expect(fakes.sessionStore.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'idle_expired' }),
    );
  });

  it('revokes session when user is inactive or missing', async () => {
    const fakes = createFakes();
    (fakes.sessionStore.findUserById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'disabled',
    });

    await expect(
      authenticateApplicationSession(
        { sessionCookie: validCookie },
        {
          ...fakes,
          now: () => sampleNow,
          sessionIdleTtlSeconds: 1800,
          sessionRotationSeconds: 900,
          sessionRotationGraceSeconds: 30,
          sessionTouchIntervalSeconds: 300,
        },
      ),
    ).rejects.toThrow(AuthenticationRequiredError);

    expect(fakes.sessionStore.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'user_unavailable' }),
    );
  });

  it('rotates session when due for rotation and returns new token', async () => {
    // Rotated at 11:40 (20 min ago > 15 min rotation interval)
    const sessionDueForRotation = createActiveSessionSnapshot({
      rotatedAt: '2026-11-02T11:40:00.000Z',
    });
    const fakes = createFakes(sessionDueForRotation);

    const ctx = await authenticateApplicationSession(
      { sessionCookie: validCookie },
      {
        ...fakes,
        now: () => sampleNow,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );

    expect(ctx.rotatedToken).toBe('new-rotated-token-32-bytes-base64url-val');
    expect(fakes.sessionStore.rotateSession).toHaveBeenCalledTimes(1);
  });

  it('authenticates through previous token grace without rotating again', async () => {
    const sessionInGrace = createActiveSessionSnapshot({
      currentTokenHash: new Uint8Array(32).fill(99),
      previousTokenHash: cookieHash,
      previousTokenValidUntil: '2026-11-02T12:00:20.000Z', // 20s left of grace
      rotatedAt: '2026-11-02T11:59:50.000Z',
    });
    const fakes = createFakes(sessionInGrace);

    const ctx = await authenticateApplicationSession(
      { sessionCookie: validCookie },
      {
        ...fakes,
        now: () => sampleNow,
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );

    expect(ctx.rotatedToken).toBeNull();
    expect(fakes.sessionStore.rotateSession).not.toHaveBeenCalled();
  });
});
