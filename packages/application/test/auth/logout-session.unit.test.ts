import { describe, expect, it, vi } from 'vitest';
import { logoutApplicationSession } from '../../src/auth/logout-session.js';
import type { AuthCryptoPort, SessionStorePort } from '../../src/auth/ports.js';

describe('packages/application - logoutApplicationSession', () => {
  const sampleNow = new Date('2026-11-02T12:00:00.000Z');
  const validCookie = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('revokes matching sessions when valid session cookie provided', async () => {
    const crypto: AuthCryptoPort = {
      hashToken: vi.fn().mockReturnValue(new Uint8Array(32).fill(9)),
    } as unknown as AuthCryptoPort;

    const sessionStore: SessionStorePort = {
      revokeMatchingSessionsByTokenHash: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionStorePort;

    await logoutApplicationSession(
      { sessionCookie: validCookie },
      {
        crypto,
        sessionStore,
        now: () => sampleNow,
      },
    );

    expect(sessionStore.revokeMatchingSessionsByTokenHash).toHaveBeenCalledWith({
      tokenHash: new Uint8Array(32).fill(9),
      revokedAt: '2026-11-02T12:00:00.000Z',
      reason: 'logout',
    });
  });

  it('is completely idempotent when cookie is missing or invalid', async () => {
    const sessionStore: SessionStorePort = {
      revokeMatchingSessionsByTokenHash: vi.fn(),
    } as unknown as SessionStorePort;

    const crypto = {
      hashToken: vi.fn(),
    } as unknown as AuthCryptoPort;

    await logoutApplicationSession(
      { sessionCookie: undefined },
      {
        crypto,
        sessionStore,
        now: () => sampleNow,
      },
    );

    expect(sessionStore.revokeMatchingSessionsByTokenHash).not.toHaveBeenCalled();
  });
});
