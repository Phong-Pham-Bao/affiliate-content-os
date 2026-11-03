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

describe('packages/application - completeOidcLogin', () => {
  const sampleNow = new Date('2026-11-02T12:00:00.000Z');
  const sampleTxId = '0192b012-3456-789a-8bcd-ef0123456789';
  const sampleUserId = '0192b012-3456-789a-8bcd-ef0123456710';
  const sampleSessionId = '0192b012-3456-789a-8bcd-ef0123456720';
  const validCookie = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  function createFakes(): {
    crypto: AuthCryptoPort;
    transactionStore: LoginTransactionStorePort;
    sessionStore: SessionStorePort;
    oidc: OidcProtocolPort;
    identityResolution: ResolveVerifiedIdentityDependencies;
  } {
    return {
      crypto: {
        generateRandomToken: vi.fn().mockReturnValue('session-token-32-random-bytes-base64url-val'),
        hashToken: vi.fn().mockReturnValue(new Uint8Array(32).fill(7)),
        generateState: vi.fn(),
        generateBrowserBinding: vi.fn(),
        generateNonce: vi.fn(),
        generatePkce: vi.fn(),
        encryptSecrets: vi.fn(),
        decryptSecrets: vi.fn().mockReturnValue({
          pkceVerifier: 'sample-verifier',
          nonce: 'sample-nonce',
        }),
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
        createSession: vi.fn().mockResolvedValue(undefined),
        findCandidateSessions: vi.fn(),
        findUserById: vi.fn(),
        rotateSession: vi.fn(),
        touchSession: vi.fn(),
        revokeSession: vi.fn(),
        revokeMatchingSessionsByTokenHash: vi.fn(),
        withTransaction: vi.fn((fn) => fn()),
      },
      oidc: {
        buildAuthorizationUrl: vi.fn(),
        exchangeCodeAndValidateIdToken: vi.fn().mockResolvedValue({
          status: 'verified',
          claims: {
            issuer: 'https://auth.example.com',
            subject: 'sub-12345',
            email: 'user@example.com',
            displayName: 'Test User',
          },
        }),
      },
      identityResolution: {
        identityDirectory: {
          findUsersByIdentity: vi.fn().mockResolvedValue([
            Object.freeze({
              id: sampleUserId,
              identityProvider: 'https://auth.example.com',
              identitySubject: 'sub-12345',
              email: 'user@example.com',
              displayName: 'Test User',
              status: 'active',
              createdAt: sampleNow.toISOString(),
              updatedAt: sampleNow.toISOString(),
              version: 1,
            }),
          ]),
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

  describe('query validation', () => {
    it('rejects proxy query before touching traps', async () => {
      const fakes = createFakes();
      const trap = vi.fn();
      const proxyQuery = new Proxy({ code: 'c', state: 's' }, { get: trap });

      await expect(
        completeOidcLogin(
          { query: proxyQuery, transactionCookie: validCookie },
          {
            ...fakes,
            generateId: () => sampleSessionId,
            now: () => sampleNow,
            sessionIdleTtlSeconds: 1800,
            sessionAbsoluteTtlSeconds: 28800,
          },
        ),
      ).rejects.toThrow(OidcCallbackInvalidError);

      expect(trap).not.toHaveBeenCalled();
      expect(fakes.transactionStore.consumePendingTransaction).not.toHaveBeenCalled();
    });

    it('rejects query with extra unexpected keys', async () => {
      const fakes = createFakes();
      await expect(
        completeOidcLogin(
          { query: { code: 'c', state: 's', extra: 'bad' }, transactionCookie: validCookie },
          {
            ...fakes,
            generateId: () => sampleSessionId,
            now: () => sampleNow,
            sessionIdleTtlSeconds: 1800,
            sessionAbsoluteTtlSeconds: 28800,
          },
        ),
      ).rejects.toThrow(OidcCallbackInvalidError);

      expect(fakes.transactionStore.consumePendingTransaction).not.toHaveBeenCalled();
    });

    it('rejects missing or empty transaction cookie', async () => {
      const fakes = createFakes();
      await expect(
        completeOidcLogin(
          { query: { code: 'c', state: 's' }, transactionCookie: '' },
          {
            ...fakes,
            generateId: () => sampleSessionId,
            now: () => sampleNow,
            sessionIdleTtlSeconds: 1800,
            sessionAbsoluteTtlSeconds: 28800,
          },
        ),
      ).rejects.toThrow(OidcCallbackInvalidError);

      expect(fakes.transactionStore.consumePendingTransaction).not.toHaveBeenCalled();
    });
  });

  describe('denial handling', () => {
    it('consumes and scrubs transaction on denial, performs NO token exchange or session creation', async () => {
      const fakes = createFakes();

      await expect(
        completeOidcLogin(
          {
            query: { error: 'access_denied', state: 'sample-state' },
            transactionCookie: validCookie,
          },
          {
            ...fakes,
            generateId: () => sampleSessionId,
            now: () => sampleNow,
            sessionIdleTtlSeconds: 1800,
            sessionAbsoluteTtlSeconds: 28800,
          },
        ),
      ).rejects.toThrow(OidcCallbackInvalidError);

      expect(fakes.transactionStore.consumePendingTransaction).toHaveBeenCalledTimes(1);
      expect(fakes.crypto.decryptSecrets).not.toHaveBeenCalled();
      expect(fakes.oidc.exchangeCodeAndValidateIdToken).not.toHaveBeenCalled();
      expect(fakes.sessionStore.createSession).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('successfully consumes transaction, exchanges code, resolves identity, creates session, and returns token', async () => {
      const fakes = createFakes();

      const result = await completeOidcLogin(
        { query: { code: 'auth-code-123', state: 'sample-state' }, transactionCookie: validCookie },
        {
          ...fakes,
          generateId: () => sampleSessionId,
          now: () => sampleNow,
          sessionIdleTtlSeconds: 1800,
          sessionAbsoluteTtlSeconds: 28800,
        },
      );

      expect(result.sessionToken).toBe('session-token-32-random-bytes-base64url-val');
      expect(result.returnTo).toBe('/dashboard');
      expect(result.absoluteExpiresAt).toBe('2026-11-02T20:00:00.000Z');

      expect(fakes.transactionStore.consumePendingTransaction).toHaveBeenCalledTimes(1);
      expect(fakes.crypto.decryptSecrets).toHaveBeenCalledTimes(1);
      expect(fakes.oidc.exchangeCodeAndValidateIdToken).toHaveBeenCalledWith({
        code: 'auth-code-123',
        pkceVerifier: 'sample-verifier',
        nonce: 'sample-nonce',
      });
      expect(fakes.sessionStore.createSession).toHaveBeenCalledTimes(1);
    });

    it('translates explicit provider unavailable status to OidcProviderUnavailableError', async () => {
      const fakes = createFakes();
      (fakes.oidc.exchangeCodeAndValidateIdToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        {
          status: 'unavailable',
        },
      );

      await expect(
        completeOidcLogin(
          {
            query: { code: 'auth-code-123', state: 'sample-state' },
            transactionCookie: validCookie,
          },
          {
            ...fakes,
            generateId: () => sampleSessionId,
            now: () => sampleNow,
            sessionIdleTtlSeconds: 1800,
            sessionAbsoluteTtlSeconds: 28800,
          },
        ),
      ).rejects.toThrow(OidcProviderUnavailableError);

      expect(fakes.sessionStore.createSession).not.toHaveBeenCalled();
    });

    it('translates inactive user resolution failure to AuthenticationRequiredError', async () => {
      const fakes = createFakes();
      (
        fakes.identityResolution.identityDirectory.findUsersByIdentity as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce([
        Object.freeze({
          id: sampleUserId,
          identityProvider: 'https://auth.example.com',
          identitySubject: 'sub-12345',
          email: 'user@example.com',
          displayName: 'Test User',
          status: 'disabled',
          createdAt: sampleNow.toISOString(),
          updatedAt: sampleNow.toISOString(),
          version: 1,
        }),
      ]);

      await expect(
        completeOidcLogin(
          {
            query: { code: 'auth-code-123', state: 'sample-state' },
            transactionCookie: validCookie,
          },
          {
            ...fakes,
            generateId: () => sampleSessionId,
            now: () => sampleNow,
            sessionIdleTtlSeconds: 1800,
            sessionAbsoluteTtlSeconds: 28800,
          },
        ),
      ).rejects.toThrow(AuthenticationRequiredError);

      expect(fakes.sessionStore.createSession).not.toHaveBeenCalled();
    });
  });
});
