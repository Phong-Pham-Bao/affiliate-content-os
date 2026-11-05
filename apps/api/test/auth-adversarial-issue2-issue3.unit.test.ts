import { describe, expect, it, vi } from 'vitest';
import type { SessionStorePort } from '@affiliate-content-os/application';
import {
  authenticateApplicationSession,
  completeOidcLogin,
  OidcCallbackInvalidError,
} from '@affiliate-content-os/application';
import { createApp } from '../src/app.js';
import { COOKIE_TRANSACTION } from '../src/auth/constants.js';
import { createMockAuthDeps } from './helpers/auth-test-fakes.js';

describe('Issue 2: Callback Mutual Exclusivity and Zero-Consumption Rejection', () => {
  const validCookie = 'valid-tx-cookie-32-chars-long-123456789012';

  it('HTTP injection with conflicting code and error returns 400 with zero transaction consumption', async () => {
    let consumeCalls = 0;
    const auth = createMockAuthDeps();
    auth.loginTransactionStore.consumePendingTransaction = vi.fn(async () => {
      consumeCalls++;
      return null;
    });

    const app = createApp({ auth });
    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=c&error=e&state=s',
      cookies: { [COOKIE_TRANSACTION]: validCookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('OIDC_CALLBACK_INVALID');
    expect(consumeCalls).toBe(0);
  });

  it('HTTP injection with denial fields on success returns 400 with zero transaction consumption', async () => {
    let consumeCalls = 0;
    const auth = createMockAuthDeps();
    auth.loginTransactionStore.consumePendingTransaction = vi.fn(async () => {
      consumeCalls++;
      return null;
    });

    const app = createApp({ auth });
    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=c&state=s&error_description=denied',
      cookies: { [COOKIE_TRANSACTION]: validCookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('OIDC_CALLBACK_INVALID');
    expect(consumeCalls).toBe(0);
  });

  it('HTTP injection with C0/DEL control characters in decoded query returns 400 with zero consumption', async () => {
    let consumeCalls = 0;
    const auth = createMockAuthDeps();
    auth.loginTransactionStore.consumePendingTransaction = vi.fn(async () => {
      consumeCalls++;
      return null;
    });

    const app = createApp({ auth });
    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=c&state=s%0A',
      cookies: { [COOKIE_TRANSACTION]: validCookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('OIDC_CALLBACK_INVALID');
    expect(consumeCalls).toBe(0);
  });

  it('completeOidcLogin with state containing newline throws OidcCallbackInvalidError with zero consumption', async () => {
    let consumeCalls = 0;
    let hashCalls = 0;
    const deps = {
      crypto: {
        hashToken: vi.fn(() => {
          hashCalls++;
          return new Uint8Array(32);
        }),
        generateRandomToken: vi.fn(),
        generateState: vi.fn(),
        generateBrowserBinding: vi.fn(),
        generateNonce: vi.fn(),
        generatePkce: vi.fn(),
        encryptSecrets: vi.fn(),
        decryptSecrets: vi.fn(),
      },
      transactionStore: {
        createPendingTransaction: vi.fn(),
        consumePendingTransaction: vi.fn(async () => {
          consumeCalls++;
          return null;
        }),
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
      now: () => new Date(),
      sessionIdleTtlSeconds: 1800,
      sessionAbsoluteTtlSeconds: 28800,
    };

    await expect(
      completeOidcLogin(
        {
          query: { code: 'c', state: 's\n' },
          transactionCookie: validCookie,
        },
        deps as unknown as Parameters<typeof completeOidcLogin>[1],
      ),
    ).rejects.toThrow(OidcCallbackInvalidError);

    expect(consumeCalls).toBe(0);
    expect(hashCalls).toBe(0);
  });

  it('completeOidcLogin with conflicting code and error throws with zero consumption', async () => {
    let consumeCalls = 0;
    const deps = {
      crypto: {
        hashToken: vi.fn(() => new Uint8Array(32)),
        generateRandomToken: vi.fn(),
        generateState: vi.fn(),
        generateBrowserBinding: vi.fn(),
        generateNonce: vi.fn(),
        generatePkce: vi.fn(),
        encryptSecrets: vi.fn(),
        decryptSecrets: vi.fn(),
      },
      transactionStore: {
        createPendingTransaction: vi.fn(),
        consumePendingTransaction: vi.fn(async () => {
          consumeCalls++;
          return null;
        }),
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
      now: () => new Date(),
      sessionIdleTtlSeconds: 1800,
      sessionAbsoluteTtlSeconds: 28800,
    };

    await expect(
      completeOidcLogin(
        {
          query: { code: 'c', error: 'e', state: 's' },
          transactionCookie: validCookie,
        },
        deps as unknown as Parameters<typeof completeOidcLogin>[1],
      ),
    ).rejects.toThrow(OidcCallbackInvalidError);

    expect(consumeCalls).toBe(0);
  });
});

describe('Issue 3: Mandatory Transaction-Scoped User Lookup', () => {
  it('invokes user lookup strictly on the transaction-scoped store with zero root lookups', async () => {
    const validCookie = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const sampleUserId = '0192b012-3456-789a-8bcd-ef0123456710';
    let txLookups = 0;

    type UserRecord = NonNullable<Awaited<ReturnType<SessionStorePort['findUserById']>>>;

    const txStore: SessionStorePort = {
      createSession: vi.fn(),
      findCandidateSessions: vi.fn().mockResolvedValue([
        {
          id: '0192b012-3456-789a-8bcd-ef0123456720',
          userId: sampleUserId,
          currentTokenHash: new Uint8Array(32).fill(1),
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
        },
      ]),
      findUserById: vi.fn(async () => {
        txLookups++;
        return {
          id: sampleUserId,
          identityProvider: 'https://auth.example.com',
          identitySubject: 'sub-1',
          email: 'u@ex.com',
          displayName: 'User',
          status: 'active' as const,
          createdAt: '2026-11-02T11:00:00.000Z',
          updatedAt: '2026-11-02T11:00:00.000Z',
          version: 1,
        } as unknown as UserRecord;
      }),
      rotateSession: vi.fn(),
      touchSession: vi.fn(),
      revokeSession: vi.fn(),
      revokeMatchingSessionsByTokenHash: vi.fn(),
      withTransaction: vi.fn() as unknown as SessionStorePort['withTransaction'],
    };

    const rootStore: SessionStorePort = {
      ...txStore,
      findUserById: vi.fn(() => {
        throw new Error('ROOT_LOOKUP_SENTINEL: MUST_NOT_BE_CALLED');
      }),
      withTransaction: vi.fn(async (fn: (tx: SessionStorePort) => Promise<unknown>) =>
        fn(txStore),
      ) as unknown as SessionStorePort['withTransaction'],
    };

    const result = await authenticateApplicationSession(
      { sessionCookie: validCookie },
      {
        crypto: {
          hashToken: vi.fn().mockReturnValue(new Uint8Array(32).fill(1)),
          generateRandomToken: vi.fn().mockReturnValue('new-token-123'),
          generateState: vi.fn(),
          generateBrowserBinding: vi.fn(),
          generateNonce: vi.fn(),
          generatePkce: vi.fn(),
          encryptSecrets: vi.fn(),
          decryptSecrets: vi.fn(),
        },
        sessionStore: rootStore,
        now: () => new Date('2026-11-02T12:00:00.000Z'),
        sessionIdleTtlSeconds: 1800,
        sessionRotationSeconds: 900,
        sessionRotationGraceSeconds: 30,
        sessionTouchIntervalSeconds: 300,
      },
    );

    expect(result.user.id).toBe(sampleUserId);
    expect(txLookups).toBe(1);
    expect(rootStore.findUserById).not.toHaveBeenCalled();
  });
});
