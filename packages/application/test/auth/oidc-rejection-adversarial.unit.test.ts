import util from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { parseMembershipId, parseUserId, parseWorkspaceId } from '@affiliate-content-os/domain';
import { completeOidcLogin } from '../../src/auth/complete-oidc-login.js';
import {
  AuthenticationRequiredError,
  OidcCallbackInvalidError,
  OidcProviderUnavailableError,
} from '../../src/auth/errors.js';
import type {
  AuthCryptoPort,
  LoginTransactionStorePort,
  OidcProtocolPort,
  SessionStorePort,
} from '../../src/auth/ports.js';
import type { ResolveVerifiedIdentityDependencies } from '../../src/resolve-verified-identity.js';

describe('packages/application - OIDC Rejection Adversarial Matrix (Finding 1)', () => {
  const sampleNow = new Date('2026-11-02T12:00:00.000Z');
  const sampleTxId = '0192b012-3456-789a-8bcd-ef0123456789';
  const sampleUserId = '0192b012-3456-789a-8bcd-ef0123456710';
  const validCookie = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  function createFakes(rejectedValue: unknown): {
    crypto: AuthCryptoPort;
    transactionStore: LoginTransactionStorePort;
    sessionStore: SessionStorePort;
    oidc: OidcProtocolPort;
    identityResolution: ResolveVerifiedIdentityDependencies;
  } {
    return {
      crypto: {
        generateRandomToken: vi.fn(),
        hashToken: vi.fn().mockReturnValue(new Uint8Array(32).fill(7)),
        generateState: vi.fn(),
        generateBrowserBinding: vi.fn(),
        generateNonce: vi.fn(),
        generatePkce: vi.fn(),
        encryptSecrets: vi.fn(),
        decryptSecrets: vi.fn().mockReturnValue({ pkceVerifier: 'v', nonce: 'n' }),
      },
      transactionStore: {
        createPendingTransaction: vi.fn(),
        consumePendingTransaction: vi.fn().mockResolvedValue({
          id: sampleTxId,
          keyVersion: 'v1',
          returnTo: '/dashboard',
          encryptedSecrets: {
            ciphertext: new Uint8Array([1]),
            iv: new Uint8Array(12).fill(2),
            authTag: new Uint8Array(16).fill(3),
            keyVersion: 'v1',
          },
          createdAt: sampleNow.toISOString(),
          expiresAt: '2026-11-02T12:10:00.000Z',
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
        exchangeCodeAndValidateIdToken: vi.fn().mockRejectedValue(rejectedValue),
      },
      identityResolution: {
        identityDirectory: {
          findUsersByIdentity: vi.fn(),
          insertUserIfAbsent: vi.fn(),
        },
        clock: { now: () => sampleNow },
        idGenerator: {
          generateUserId: () => parseUserId(sampleUserId),
          generateMembershipId: () => parseMembershipId('0192b012-3456-789a-8bcd-ef0123456721'),
          generateWorkspaceId: () => parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456722'),
        },
      },
    };
  }

  async function runRejectionTest(rejectedValue: unknown): Promise<void> {
    const fakes = createFakes(rejectedValue);
    await expect(
      completeOidcLogin(
        { query: { code: 'code-1', state: 'state-1' }, transactionCookie: validCookie },
        {
          ...fakes,
          generateId: () => '0192b012-3456-789a-8bcd-ef0123456720',
          now: () => sampleNow,
          sessionIdleTtlSeconds: 1800,
          sessionAbsoluteTtlSeconds: 28800,
        },
      ),
    ).rejects.toThrow(OidcCallbackInvalidError);

    expect(fakes.identityResolution.identityDirectory.findUsersByIdentity).not.toHaveBeenCalled();
    expect(fakes.sessionStore.createSession).not.toHaveBeenCalled();
  }

  it('rejects ordinary Error with sentinel without inspection', async () => {
    await runRejectionTest(new Error('SENTINEL_ORDINARY_ERROR'));
  });

  it('rejects application error instance without classification', async () => {
    await runRejectionTest(new AuthenticationRequiredError());
  });

  it('rejects primitive string, symbol, and bigint rejections', async () => {
    await runRejectionTest('SENTINEL_PRIMITIVE_STRING');
    await runRejectionTest(Symbol('SENTINEL_SYMBOL'));
    await runRejectionTest(9876543210123456789n);
  });

  it('rejects object with hostile getters and conversion hooks without invoking hooks', async () => {
    let hooksCalled = 0;
    const hostile = {
      get name() {
        hooksCalled++;
        return 'Hostile';
      },
      get message() {
        hooksCalled++;
        return 'HostileMsg';
      },
      toString() {
        hooksCalled++;
        return 'HostileString';
      },
      valueOf() {
        hooksCalled++;
        return 1;
      },
      toJSON() {
        hooksCalled++;
        return {};
      },
      [util.inspect.custom]() {
        hooksCalled++;
        return 'HostileInspect';
      },
    };
    await runRejectionTest(hostile);
    expect(hooksCalled).toBe(0);
  });

  it('rejects proxy with throwing getPrototypeOf trap without invoking trap', async () => {
    let trapsCalled = 0;
    const hostileProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          trapsCalled++;
          throw new Error('SENTINEL_PROVIDER_ERROR');
        },
        get() {
          trapsCalled++;
          throw new Error('SENTINEL_GET');
        },
        has() {
          trapsCalled++;
          throw new Error('SENTINEL_HAS');
        },
      },
    );
    await runRejectionTest(hostileProxy);
    expect(trapsCalled).toBe(0);
  });

  it('rejects revoked proxy without unhandled exception', async () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    await runRejectionTest(proxy);
  });

  it('handles validated explicit unavailable status with OidcProviderUnavailableError', async () => {
    const fakes = createFakes(null);
    (fakes.oidc.exchangeCodeAndValidateIdToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'unavailable',
    });
    await expect(
      completeOidcLogin(
        { query: { code: 'c', state: 's' }, transactionCookie: validCookie },
        {
          ...fakes,
          generateId: () => '0192b012-3456-789a-8bcd-ef0123456720',
          now: () => sampleNow,
          sessionIdleTtlSeconds: 1800,
          sessionAbsoluteTtlSeconds: 28800,
        },
      ),
    ).rejects.toThrow(OidcProviderUnavailableError);
    expect(fakes.sessionStore.createSession).not.toHaveBeenCalled();
  });
});
