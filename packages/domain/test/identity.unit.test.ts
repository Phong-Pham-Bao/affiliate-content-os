import { describe, expect, it } from 'vitest';
import {
  createApplicationPrincipal,
  createAuthenticationSource,
  DomainValidationError,
  parseIsoTimestamp,
  parseUserId,
  validateIdentityClaims,
  type UserSnapshot,
} from '../src/index.js';

describe('Domain Identity and Claims Validation', () => {
  describe('validateIdentityClaims - claims root validation', () => {
    it('accepts valid claims with Object.prototype', () => {
      const claims = {
        identityProvider: 'https://issuer.example.com',
        identitySubject: 'sub-12345',
      };
      const validated = validateIdentityClaims(claims);
      expect(validated.identityProvider).toBe('https://issuer.example.com');
      expect(validated.identitySubject).toBe('sub-12345');
      expect(validated.email).toBeNull();
      expect(validated.displayName).toBeNull();
      expect(Object.isFrozen(validated)).toBe(true);
    });

    it('accepts valid claims with null prototype', () => {
      const claims = Object.create(null);
      claims.identityProvider = 'provider-a';
      claims.identitySubject = 'sub-abc';
      claims.email = 'user@example.com';
      claims.displayName = 'Test User';

      const validated = validateIdentityClaims(claims);
      expect(validated.identityProvider).toBe('provider-a');
      expect(validated.identitySubject).toBe('sub-abc');
      expect(validated.email).toBe('user@example.com');
      expect(validated.displayName).toBe('Test User');
      expect(Object.isFrozen(validated)).toBe(true);
    });

    it('rejects null, undefined, and non-object primitives with field "claims"', () => {
      const primitives = [null, undefined, 42, 'string', true, Symbol('token'), BigInt(100)];
      for (const val of primitives) {
        expect(() => validateIdentityClaims(val)).toThrow(DomainValidationError);
        expect(() => validateIdentityClaims(val)).toThrowError(
          expect.objectContaining({ field: 'claims' }),
        );
      }
    });

    it('rejects arrays and functions with field "claims"', () => {
      expect(() => validateIdentityClaims([])).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
      expect(() => validateIdentityClaims(() => ({}))).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
    });

    it('rejects objects with prototype other than Object.prototype or null', () => {
      class ProviderJwtClaims {
        identityProvider = 'https://issuer.example.com';
        identitySubject = 'sub-1';
      }
      expect(() => validateIdentityClaims(new ProviderJwtClaims())).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );

      const customProto = Object.create({ inherited: true });
      customProto.identityProvider = 'p';
      customProto.identitySubject = 's';
      expect(() => validateIdentityClaims(customProto)).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
    });

    it('rejects extra own keys with field "claims"', () => {
      const withExtra = {
        identityProvider: 'p',
        identitySubject: 's',
        extraKey: 'forbidden',
      };
      expect(() => validateIdentityClaims(withExtra)).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );

      const withSymbol = {
        identityProvider: 'p',
        identitySubject: 's',
        [Symbol('custom')]: 'forbidden',
      };
      expect(() => validateIdentityClaims(withSymbol)).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
    });

    it('rejects missing required keys with field "claims"', () => {
      expect(() => validateIdentityClaims({})).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
      expect(() => validateIdentityClaims({ identityProvider: 'p' })).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
      expect(() => validateIdentityClaims({ identitySubject: 's' })).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
    });

    it('rejects cyclic objects with field "claims"', () => {
      const cyclic: Record<string, unknown> = {
        identityProvider: 'p',
        identitySubject: 's',
      };
      cyclic.self = cyclic;
      expect(() => validateIdentityClaims(cyclic)).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
    });

    it('rejects hostile proxies throwing traps with field "claims"', () => {
      const throwingProxy = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('hostile prototype');
          },
        },
      );
      expect(() => validateIdentityClaims(throwingProxy)).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );

      const throwingKeysProxy = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('hostile ownKeys');
          },
        },
      );
      expect(() => validateIdentityClaims(throwingKeysProxy)).toThrowError(
        expect.objectContaining({ field: 'claims' }),
      );
    });
  });

  describe('validateIdentityClaims - provider and subject validation', () => {
    it('rejects non-string provider and subject', () => {
      expect(() =>
        validateIdentityClaims({ identityProvider: 123, identitySubject: 's' }),
      ).toThrowError(expect.objectContaining({ field: 'identityProvider' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: false }),
      ).toThrowError(expect.objectContaining({ field: 'identitySubject' }));
    });

    it('rejects empty or whitespace-only provider and subject', () => {
      expect(() =>
        validateIdentityClaims({ identityProvider: '', identitySubject: 's' }),
      ).toThrowError(expect.objectContaining({ field: 'identityProvider' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: '   ', identitySubject: 's' }),
      ).toThrowError(expect.objectContaining({ field: 'identityProvider' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: '' }),
      ).toThrowError(expect.objectContaining({ field: 'identitySubject' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: '\t\n' }),
      ).toThrowError(expect.objectContaining({ field: 'identitySubject' }));
    });

    it('rejects surrounding whitespace (leading, trailing, both) on provider/subject', () => {
      expect(() =>
        validateIdentityClaims({ identityProvider: ' prov', identitySubject: 's' }),
      ).toThrowError(expect.objectContaining({ field: 'identityProvider' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'prov ', identitySubject: 's' }),
      ).toThrowError(expect.objectContaining({ field: 'identityProvider' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: ' prov ', identitySubject: 's' }),
      ).toThrowError(expect.objectContaining({ field: 'identityProvider' }));

      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: ' sub' }),
      ).toThrowError(expect.objectContaining({ field: 'identitySubject' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: 'sub ' }),
      ).toThrowError(expect.objectContaining({ field: 'identitySubject' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: ' sub ' }),
      ).toThrowError(expect.objectContaining({ field: 'identitySubject' }));
    });

    it('rejects accessor properties (getters/setters) on provider and subject without calling them', () => {
      let getterCalled = false;
      const obj = {
        get identityProvider() {
          getterCalled = true;
          return 'p';
        },
        identitySubject: 's',
      };
      expect(() => validateIdentityClaims(obj)).toThrowError(
        expect.objectContaining({ field: 'identityProvider' }),
      );
      expect(getterCalled).toBe(false);
    });

    it('preserves casing, internal whitespace, and Unicode exactly', () => {
      const claims = {
        identityProvider: 'Issuer With Spaces',
        identitySubject: 'sub|id-123_456:UNICODE_đà_nẵng',
      };
      const validated = validateIdentityClaims(claims);
      expect(validated.identityProvider).toBe('Issuer With Spaces');
      expect(validated.identitySubject).toBe('sub|id-123_456:UNICODE_đà_nẵng');
    });
  });

  describe('validateIdentityClaims - optional email and displayName', () => {
    it('accepts undefined and null, normalizing to null', () => {
      const claims1 = {
        identityProvider: 'p',
        identitySubject: 's',
        email: undefined,
        displayName: null,
      };
      const val1 = validateIdentityClaims(claims1);
      expect(val1.email).toBeNull();
      expect(val1.displayName).toBeNull();
    });

    it('trims whitespace and converts empty trimmed result to null', () => {
      const claims = {
        identityProvider: 'p',
        identitySubject: 's',
        email: '   ',
        displayName: '  \t  ',
      };
      const val = validateIdentityClaims(claims);
      expect(val.email).toBeNull();
      expect(val.displayName).toBeNull();

      const claimsWithContent = {
        identityProvider: 'p',
        identitySubject: 's',
        email: '  user@example.COM  ',
        displayName: '  Alice Bob  ',
      };
      const val2 = validateIdentityClaims(claimsWithContent);
      expect(val2.email).toBe('user@example.COM'); // Case preserved, no lowercasing
      expect(val2.displayName).toBe('Alice Bob');
    });

    it('rejects non-string non-null types for email and displayName', () => {
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: 's', email: 123 }),
      ).toThrowError(expect.objectContaining({ field: 'email' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: 's', email: true }),
      ).toThrowError(expect.objectContaining({ field: 'email' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: 's', email: {} }),
      ).toThrowError(expect.objectContaining({ field: 'email' }));

      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: 's', displayName: 123 }),
      ).toThrowError(expect.objectContaining({ field: 'displayName' }));
      expect(() =>
        validateIdentityClaims({ identityProvider: 'p', identitySubject: 's', displayName: [] }),
      ).toThrowError(expect.objectContaining({ field: 'displayName' }));
    });

    it('rejects accessors on email and displayName without calling them', () => {
      let emailGetterCalled = false;
      const obj = {
        identityProvider: 'p',
        identitySubject: 's',
        get email() {
          emailGetterCalled = true;
          return 'test@example.com';
        },
      };
      expect(() => validateIdentityClaims(obj)).toThrowError(
        expect.objectContaining({ field: 'email' }),
      );
      expect(emailGetterCalled).toBe(false);
    });
  });

  describe('createAuthenticationSource and createApplicationPrincipal', () => {
    it('creates frozen AuthenticationSource and ApplicationPrincipal', () => {
      const source = createAuthenticationSource('https://auth.example.com');
      expect(source.kind).toBe('verified_oidc');
      expect(source.identityProvider).toBe('https://auth.example.com');
      expect(Object.isFrozen(source)).toBe(true);

      const fakeUser: UserSnapshot = Object.freeze({
        id: parseUserId('018f6c38-7654-7123-8abc-def012345678'),
        identityProvider: 'https://auth.example.com',
        identitySubject: 'sub-xyz',
        email: 'user@example.com',
        displayName: 'Test User',
        status: 'active',
        createdAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        version: 1,
      });

      const principal = createApplicationPrincipal(fakeUser, source);
      expect(principal.user).toBe(fakeUser);
      expect(principal.authenticationSource).toBe(source);
      expect(Object.isFrozen(principal)).toBe(true);
    });
  });
});
