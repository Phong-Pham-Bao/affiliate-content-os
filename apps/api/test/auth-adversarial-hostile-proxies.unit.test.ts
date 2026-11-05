import { describe, expect, it, vi } from 'vitest';
import {
  authenticateApplicationSession,
  AuthenticationRequiredError,
  getCurrentUser,
  OidcCallbackInvalidError,
  completeOidcLogin,
} from '@affiliate-content-os/application';
import { resolveProblemSpec } from '../src/auth/problem-details.js';

describe('Auth Adversarial Hostile Proxies and Traps', () => {
  it('safely maps Proxy error with throwing getPrototypeOf trap to INTERNAL_ERROR with zero trap calls', () => {
    let trapCalls = 0;
    const target = {};
    const proxyError = new Proxy(target, {
      getPrototypeOf() {
        trapCalls++;
        throw new Error('PROXY_TRAP_SENTINEL');
      },
    });

    const spec = resolveProblemSpec(proxyError);
    expect(spec.code).toBe('INTERNAL_ERROR');
    expect(spec.status).toBe(500);
    expect(trapCalls).toBe(0);
  });

  it('safely maps revoked Proxy error to INTERNAL_ERROR with zero exception escape', () => {
    const { proxy, revoke } = Proxy.revocable({ code: 'ERR' }, {});
    revoke();

    const spec = resolveProblemSpec(proxy);
    expect(spec.code).toBe('INTERNAL_ERROR');
    expect(spec.status).toBe(500);
  });

  it('rejects candidate session DTO with throwing revokedAt getter with zero trap calls', async () => {
    let getterCalls = 0;
    const cookieHash = new Uint8Array(32).fill(1);
    const validCookie = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const hostileSession = {
      id: '0192b012-3456-789a-8bcd-ef0123456720',
      userId: '0192b012-3456-789a-8bcd-ef0123456710',
      currentTokenHash: cookieHash,
      previousTokenHash: null,
      previousTokenValidUntil: null,
      createdAt: '2026-11-02T11:00:00.000Z',
      lastSeenAt: '2026-11-02T11:58:00.000Z',
      idleExpiresAt: '2026-11-02T12:28:00.000Z',
      absoluteExpiresAt: '2026-11-02T19:00:00.000Z',
      rotatedAt: '2026-11-02T11:50:00.000Z',
      get revokedAt(): string | null {
        getterCalls++;
        throw new Error('SESSION_GETTER_SENTINEL');
      },
      revocationReason: null,
      version: 1,
    };

    const deps = {
      crypto: {
        generateRandomToken: vi.fn(),
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
        findCandidateSessions: vi.fn().mockResolvedValue([hostileSession]),
        findUserById: vi.fn(),
        rotateSession: vi.fn(),
        touchSession: vi.fn(),
        revokeSession: vi.fn(),
        revokeMatchingSessionsByTokenHash: vi.fn(),
        withTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(deps.sessionStore),
      },
      now: () => new Date('2026-11-02T12:00:00.000Z'),
      sessionIdleTtlSeconds: 1800,
      sessionRotationSeconds: 900,
      sessionRotationGraceSeconds: 30,
      sessionTouchIntervalSeconds: 300,
    };

    await expect(
      authenticateApplicationSession(
        { sessionCookie: validCookie },
        deps as unknown as Parameters<typeof authenticateApplicationSession>[1],
      ),
    ).rejects.toThrow(AuthenticationRequiredError);

    expect(getterCalls).toBe(0);
  });

  it('rejects consumed transaction DTO with throwing returnTo getter with zero trap calls', async () => {
    let getterCalls = 0;
    const hostileConsumed = {
      id: '0192b012-3456-789a-8bcd-ef0123456789',
      keyVersion: 'v1',
      get returnTo(): string {
        getterCalls++;
        throw new Error('TX_GETTER_SENTINEL');
      },
      encryptedSecrets: {
        ciphertext: new Uint8Array([1, 2, 3]),
        iv: new Uint8Array(12).fill(4),
        authTag: new Uint8Array(16).fill(5),
        keyVersion: 'v1',
      },
      createdAt: '2026-11-02T12:00:00.000Z',
      expiresAt: '2026-11-02T12:10:00.000Z',
    };

    const deps = {
      crypto: {
        hashToken: vi.fn().mockReturnValue(new Uint8Array(32).fill(1)),
        generateRandomToken: vi.fn(),
        decryptSecrets: vi.fn(),
        generateState: vi.fn(),
        generateBrowserBinding: vi.fn(),
        generateNonce: vi.fn(),
        generatePkce: vi.fn(),
        encryptSecrets: vi.fn(),
      },
      transactionStore: {
        createPendingTransaction: vi.fn(),
        consumePendingTransaction: vi.fn().mockResolvedValue(hostileConsumed),
      },
      sessionStore: {
        createSession: vi.fn(),
        findCandidateSessions: vi.fn(),
        findUserById: vi.fn(),
        rotateSession: vi.fn(),
        touchSession: vi.fn(),
        revokeSession: vi.fn(),
        revokeMatchingSessionsByTokenHash: vi.fn(),
        withTransaction: vi.fn(),
      },
      oidc: {
        buildAuthorizationUrl: vi.fn(),
        exchangeCodeAndValidateIdToken: vi.fn(),
      },
      identityResolution: {} as unknown as Parameters<
        typeof completeOidcLogin
      >[1]['identityResolution'],
      generateId: vi.fn(),
      now: () => new Date('2026-11-02T12:00:00.000Z'),
      sessionIdleTtlSeconds: 1800,
      sessionAbsoluteTtlSeconds: 28800,
    };

    await expect(
      completeOidcLogin(
        {
          query: { code: 'code-123', state: 'state-123' },
          transactionCookie: 'valid-tx-cookie-32-chars-long-123456789012',
        },
        deps as unknown as Parameters<typeof completeOidcLogin>[1],
      ),
    ).rejects.toThrow(OidcCallbackInvalidError);

    expect(getterCalls).toBe(0);
  });

  it('rejects hostile summaries in getCurrentUser with zero getter calls', async () => {
    let getterCalls = 0;
    const hostileSummaries = {
      get items(): unknown {
        getterCalls++;
        throw new Error('SUMMARIES_GETTER_SENTINEL');
      },
      hasMore: false,
    };

    const listSpy = vi.fn().mockResolvedValue(hostileSummaries);
    const context = {
      user: {
        id: '0192b012-3456-789a-8bcd-ef0123456710',
        identityProvider: 'https://auth.example.com',
        identitySubject: 'sub-1',
        email: 'u@ex.com',
        displayName: 'User',
        status: 'active',
        createdAt: '2026-11-02T10:00:00.000Z',
        updatedAt: '2026-11-02T10:00:00.000Z',
        version: 1,
      },
      session: {
        id: '0192b012-3456-789a-8bcd-ef0123456720',
        userId: '0192b012-3456-789a-8bcd-ef0123456710',
        idleExpiresAt: '2026-11-02T12:30:00.000Z',
        absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
      },
      rotatedToken: null,
    };

    await expect(
      getCurrentUser(context as unknown as Parameters<typeof getCurrentUser>[0], {
        workspaceSummary: {
          listActiveWorkspaceSummaries: listSpy,
        },
      }),
    ).rejects.toThrow(AuthenticationRequiredError);

    expect(getterCalls).toBe(0);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects hostile user properties in getCurrentUser with zero getter calls and zero workspace calls', async () => {
    let getterCalls = 0;
    const listSpy = vi.fn();
    const hostileUser = {
      id: '0192b012-3456-789a-8bcd-ef0123456710',
      identityProvider: 'https://auth.example.com',
      identitySubject: 'sub-1',
      email: 'u@ex.com',
      displayName: 'User',
      get status(): string {
        getterCalls++;
        throw new Error('STATUS_GETTER_SENTINEL');
      },
      createdAt: '2026-11-02T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      version: 1,
    };

    const context = {
      user: hostileUser,
      session: {
        id: '0192b012-3456-789a-8bcd-ef0123456720',
        userId: '0192b012-3456-789a-8bcd-ef0123456710',
        idleExpiresAt: '2026-11-02T12:30:00.000Z',
        absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
      },
      rotatedToken: null,
    };

    await expect(
      getCurrentUser(context as unknown as Parameters<typeof getCurrentUser>[0], {
        workspaceSummary: { listActiveWorkspaceSummaries: listSpy },
      }),
    ).rejects.toThrow(AuthenticationRequiredError);

    expect(getterCalls).toBe(0);
    expect(listSpy).toHaveBeenCalledTimes(0);
  });
});
