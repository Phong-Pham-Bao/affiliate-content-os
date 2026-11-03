import { describe, expect, it, vi } from 'vitest';
import { beginOidcLogin, validateReturnTo } from '../../src/auth/begin-oidc-login.js';
import { AuthPersistenceError, AuthRequestValidationError } from '../../src/auth/errors.js';
import type {
  AuthCryptoPort,
  LoginTransactionStorePort,
  OidcProtocolPort,
} from '../../src/auth/ports.js';

describe('packages/application - beginOidcLogin', () => {
  const sampleNow = new Date('2026-11-02T12:00:00.000Z');
  const sampleTxId = '0192b012-3456-789a-8bcd-ef0123456789';

  function createFakes(): {
    crypto: AuthCryptoPort;
    transactionStore: LoginTransactionStorePort;
    oidc: OidcProtocolPort;
  } {
    return {
      crypto: {
        generateRandomToken: vi.fn(),
        hashToken: vi.fn(),
        generateState: vi.fn().mockReturnValue({
          raw: 'state-raw-32-chars-long-base64url',
          hash: new Uint8Array(32).fill(1),
        }),
        generateBrowserBinding: vi.fn().mockReturnValue({
          raw: 'browser-binding-raw-32-chars-base64url',
          hash: new Uint8Array(32).fill(2),
        }),
        generateNonce: vi.fn().mockReturnValue('nonce-raw-base64url'),
        generatePkce: vi.fn().mockReturnValue({
          verifier: 'pkce-verifier-raw',
          challenge: 'pkce-challenge-raw',
        }),
        encryptSecrets: vi.fn().mockReturnValue({
          ciphertext: new Uint8Array([1, 2, 3]),
          iv: new Uint8Array(12).fill(4),
          authTag: new Uint8Array(16).fill(5),
          keyVersion: 'v1',
        }),
        decryptSecrets: vi.fn(),
      },
      transactionStore: {
        createPendingTransaction: vi.fn().mockResolvedValue(undefined),
        consumePendingTransaction: vi.fn(),
      },
      oidc: {
        buildAuthorizationUrl: vi
          .fn()
          .mockReturnValue('https://auth.example.com/oauth/authorize?state=1'),
        exchangeCodeAndValidateIdToken: vi.fn(),
      },
    };
  }

  describe('returnTo validation', () => {
    it('defaults undefined, null, or empty string to /', () => {
      expect(validateReturnTo(undefined)).toBe('/');
      expect(validateReturnTo(null)).toBe('/');
      expect(validateReturnTo('')).toBe('/');
    });

    it('accepts valid local paths', () => {
      expect(validateReturnTo('/dashboard')).toBe('/dashboard');
      expect(validateReturnTo('/workspaces/123?tab=settings')).toBe('/workspaces/123?tab=settings');
    });

    it('rejects protocol-relative and scheme-relative URLs', () => {
      expect(() => validateReturnTo('//evil.com')).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('//evil.com/path')).toThrow(AuthRequestValidationError);
    });

    it('rejects backslashes and control characters', () => {
      expect(() => validateReturnTo('/path\\sub')).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('/path\0null')).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('/path\nnewline')).toThrow(AuthRequestValidationError);
    });

    it('rejects fragments, encoded separators, and double encoding', () => {
      expect(() => validateReturnTo('/ok#fragment')).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('/%5cevil')).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('/%2f%2fevil.example')).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('/%252f%252fevil.example')).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('/%23fragment')).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('/path?foo=%252f')).toThrow(AuthRequestValidationError);
    });

    it('rejects non-string and lengths over 2048', () => {
      expect(() => validateReturnTo(123)).toThrow(AuthRequestValidationError);
      expect(() => validateReturnTo('/' + 'a'.repeat(2048))).toThrow(AuthRequestValidationError);
    });

    it('asserts zero dependency calls on returnTo failure', async () => {
      const fakes = createFakes();
      await expect(
        beginOidcLogin(
          { returnTo: '//malicious.com' },
          {
            crypto: fakes.crypto,
            transactionStore: fakes.transactionStore,
            oidc: fakes.oidc,
            generateId: () => sampleTxId,
            now: () => sampleNow,
            transactionTtlSeconds: 600,
          },
        ),
      ).rejects.toThrow(AuthRequestValidationError);

      expect(fakes.crypto.generateState).not.toHaveBeenCalled();
      expect(fakes.transactionStore.createPendingTransaction).not.toHaveBeenCalled();
      expect(fakes.oidc.buildAuthorizationUrl).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('generates state, binding, nonce, PKCE, persists transaction, and builds authorization URL', async () => {
      const fakes = createFakes();
      const result = await beginOidcLogin(
        { returnTo: '/dashboard' },
        {
          crypto: fakes.crypto,
          transactionStore: fakes.transactionStore,
          oidc: fakes.oidc,
          generateId: () => sampleTxId,
          now: () => sampleNow,
          transactionTtlSeconds: 600,
        },
      );

      expect(result.authorizationUrl).toBe('https://auth.example.com/oauth/authorize?state=1');
      expect(result.transactionCookieValue).toBe('browser-binding-raw-32-chars-base64url');
      expect(result.expiresAt).toEqual(new Date('2026-11-02T12:10:00.000Z'));

      expect(fakes.transactionStore.createPendingTransaction).toHaveBeenCalledTimes(1);
      const call = (fakes.transactionStore.createPendingTransaction as ReturnType<typeof vi.fn>)
        .mock.calls[0]![0];
      expect(call.id).toBe(sampleTxId);
      expect(call.returnTo).toBe('/dashboard');
      expect(call.createdAt).toBe('2026-11-02T12:00:00.000Z');
      expect(call.expiresAt).toBe('2026-11-02T12:10:00.000Z');
    });

    it('translates store failures to AuthPersistenceError(transaction)', async () => {
      const fakes = createFakes();
      (
        fakes.transactionStore.createPendingTransaction as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('db down'));

      await expect(
        beginOidcLogin(
          { returnTo: '/dashboard' },
          {
            crypto: fakes.crypto,
            transactionStore: fakes.transactionStore,
            oidc: fakes.oidc,
            generateId: () => sampleTxId,
            now: () => sampleNow,
            transactionTtlSeconds: 600,
          },
        ),
      ).rejects.toThrow(AuthPersistenceError);

      expect(fakes.oidc.buildAuthorizationUrl).not.toHaveBeenCalled();
    });
  });
});
