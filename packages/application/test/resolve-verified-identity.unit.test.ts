import { describe, expect, it, vi } from 'vitest';
import {
  parseAuditEventId,
  parseIdempotencyKeyId,
  parseIsoTimestamp,
  parseUserId,
  type ApplicationPrincipal,
  type UserSnapshot,
} from '@affiliate-content-os/domain';
import {
  IdentityClaimsValidationError,
  IdentityPersistenceError,
  IdentityProvisioningRaceError,
  IdentityUnavailableError,
  resolveVerifiedIdentity,
  ValidationError,
  type ClockPort,
  type IdGeneratorPort,
  type ResolveVerifiedIdentityDependencies,
  type UserIdentityDirectoryPort,
} from '../src/index.js';

function createMockClock(isoString = '2026-11-01T00:00:00.000Z'): ClockPort {
  return {
    now: vi.fn(() => new Date(isoString)),
  };
}

function createMockIdGenerator(userId = '018f6c38-7654-7123-8abc-def012345678'): IdGeneratorPort {
  return {
    generateId: vi.fn(() => '018f6c38-7654-7123-8abc-def012345679'),
    generateWorkspaceId: vi.fn(),
    generateMembershipId: vi.fn(),
    generateUserId: vi.fn(() => parseUserId(userId)),
    generateAuditEventId: vi.fn(() => parseAuditEventId('018f6c38-7654-7123-8abc-def01234567a')),
    generateIdempotencyKeyId: vi.fn(() =>
      parseIdempotencyKeyId('018f6c38-7654-7123-8abc-def01234567b'),
    ),
  };
}

function createMockDirectory(): UserIdentityDirectoryPort {
  return {
    findUsersByIdentity: vi.fn(),
    insertUserIfAbsent: vi.fn(),
  };
}

function createValidActiveSnapshot(overrides: Partial<UserSnapshot> = {}): UserSnapshot {
  return Object.freeze({
    id: parseUserId('018f6c38-7654-7123-8abc-def012345678'),
    identityProvider: 'https://auth.example.com',
    identitySubject: 'sub-12345',
    email: 'user@example.com',
    displayName: 'Active User',
    status: 'active',
    createdAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
    version: 1,
    ...overrides,
  });
}

describe('resolveVerifiedIdentity Use Case', () => {
  describe('Input Claims Validation & Non-Disclosure', () => {
    it('rejects invalid root claims and invokes ZERO dependencies', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      const invalidClaimsList = [
        null,
        undefined,
        123,
        'string',
        true,
        [],
        () => ({}),
        Symbol('token'),
        BigInt(99),
        {}, // missing required keys
        { identityProvider: 'prov' }, // missing subject
        { identitySubject: 'sub' }, // missing provider
        { identityProvider: 'prov', identitySubject: 'sub', extra: 1 }, // extra key
      ];

      for (const invalidClaims of invalidClaimsList) {
        await expect(resolveVerifiedIdentity({ claims: invalidClaims }, deps)).rejects.toThrow(
          IdentityClaimsValidationError,
        );
      }

      expect(directory.findUsersByIdentity).not.toHaveBeenCalled();
      expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
      expect(clock.now).not.toHaveBeenCalled();
      expect(idGenerator.generateUserId).not.toHaveBeenCalled();
    });

    it('rejects proxy and revoked-proxy claims with zero traps/hooks and zero dependency calls', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      const traps = [
        'get',
        'getPrototypeOf',
        'ownKeys',
        'getOwnPropertyDescriptor',
        'has',
        'set',
      ] as const;

      for (const trapName of traps) {
        let trapCount = 0;
        const sentinel = `SENTINEL_APP_TRAP_${trapName}_12345`;
        const handler: ProxyHandler<object> = {
          [trapName]: () => {
            trapCount++;
            throw new Error(sentinel);
          },
        };
        const target = {
          identityProvider: 'https://auth.example.com',
          identitySubject: 'sub-12345',
        };
        const proxy = new Proxy(target, handler);

        let caught1: unknown;
        let caught2: unknown;
        try {
          await resolveVerifiedIdentity({ claims: proxy }, deps);
        } catch (err) {
          caught1 = err;
        }
        try {
          await resolveVerifiedIdentity({ claims: proxy }, deps);
        } catch (err) {
          caught2 = err;
        }

        expect(trapCount).toBe(0);
        expect(caught1).toBeInstanceOf(IdentityClaimsValidationError);
        const claimsErr = caught1 as IdentityClaimsValidationError;
        expect(claimsErr.code).toBe('IDENTITY_CLAIMS_INVALID');
        expect(claimsErr.field).toBe('claims');
        expect(claimsErr.message).toBe('Invalid identity claims');
        expect(caught1).not.toBe(caught2); // Fresh error identity across repeated failures

        expect(directory.findUsersByIdentity).not.toHaveBeenCalled();
        expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
        expect(clock.now).not.toHaveBeenCalled();
        expect(idGenerator.generateUserId).not.toHaveBeenCalled();
      }

      // Proxy with all traps and hooks installed
      let allTrapsCount = 0;
      let allHooksCount = 0;
      const allSentinel = 'SENTINEL_APP_ALL_TRAPS_99999';
      const target: Record<string | symbol, unknown> = {
        identityProvider: 'https://auth.example.com',
        identitySubject: 'sub-12345',
        toString() {
          allHooksCount++;
          throw new Error(allSentinel);
        },
        valueOf() {
          allHooksCount++;
          throw new Error(allSentinel);
        },
        toJSON() {
          allHooksCount++;
          throw new Error(allSentinel);
        },
        [Symbol.iterator]() {
          allHooksCount++;
          throw new Error(allSentinel);
        },
        [Symbol.for('nodejs.util.inspect.custom')]() {
          allHooksCount++;
          throw new Error(allSentinel);
        },
      };

      const proxyAll = new Proxy(target, {
        get() {
          allTrapsCount++;
          throw new Error(allSentinel);
        },
        getPrototypeOf() {
          allTrapsCount++;
          throw new Error(allSentinel);
        },
        ownKeys() {
          allTrapsCount++;
          throw new Error(allSentinel);
        },
        getOwnPropertyDescriptor() {
          allTrapsCount++;
          throw new Error(allSentinel);
        },
        has() {
          allTrapsCount++;
          throw new Error(allSentinel);
        },
        set() {
          allTrapsCount++;
          throw new Error(allSentinel);
        },
      });

      await expect(resolveVerifiedIdentity({ claims: proxyAll }, deps)).rejects.toThrow(
        IdentityClaimsValidationError,
      );
      expect(allTrapsCount).toBe(0);
      expect(allHooksCount).toBe(0);

      // Revoked proxy
      let revokedTrapCount = 0;
      const { proxy: revokedProxy, revoke } = Proxy.revocable(
        { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
        {
          get() {
            revokedTrapCount++;
            throw new Error('REVOKED_TRAP');
          },
          getPrototypeOf() {
            revokedTrapCount++;
            throw new Error('REVOKED_TRAP');
          },
        },
      );
      revoke();

      await expect(resolveVerifiedIdentity({ claims: revokedProxy }, deps)).rejects.toThrow(
        IdentityClaimsValidationError,
      );
      expect(revokedTrapCount).toBe(0);

      expect(directory.findUsersByIdentity).not.toHaveBeenCalled();
      expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
      expect(clock.now).not.toHaveBeenCalled();
      expect(idGenerator.generateUserId).not.toHaveBeenCalled();
    });

    it('translates provider and subject validation failures with exact field and safe message', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      // Leading/trailing whitespace on provider
      try {
        await resolveVerifiedIdentity(
          { claims: { identityProvider: '  prov  ', identitySubject: 'sub' } },
          deps,
        );
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityClaimsValidationError);
        const claimsErr = err as IdentityClaimsValidationError;
        expect(claimsErr.field).toBe('identityProvider');
        expect(claimsErr.message).toBe('Invalid identity claims');
        expect(claimsErr.message).not.toContain('prov');
      }

      // Leading/trailing whitespace on subject
      try {
        await resolveVerifiedIdentity(
          { claims: { identityProvider: 'prov', identitySubject: ' sub' } },
          deps,
        );
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityClaimsValidationError);
        const claimsErr = err as IdentityClaimsValidationError;
        expect(claimsErr.field).toBe('identitySubject');
        expect(claimsErr.message).toBe('Invalid identity claims');
        expect(claimsErr.message).not.toContain('sub');
      }

      expect(directory.findUsersByIdentity).not.toHaveBeenCalled();
    });

    it('translates email and displayName errors to exact fields without disclosing values', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      try {
        await resolveVerifiedIdentity(
          { claims: { identityProvider: 'prov', identitySubject: 'sub', email: 12345 } },
          deps,
        );
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityClaimsValidationError);
        const claimsErr = err as IdentityClaimsValidationError;
        expect(claimsErr.field).toBe('email');
        expect(claimsErr.message).toBe('Invalid identity claims');
        expect(claimsErr.message).not.toContain('12345');
      }

      try {
        await resolveVerifiedIdentity(
          { claims: { identityProvider: 'prov', identitySubject: 'sub', displayName: false } },
          deps,
        );
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityClaimsValidationError);
        const claimsErr = err as IdentityClaimsValidationError;
        expect(claimsErr.field).toBe('displayName');
        expect(claimsErr.message).toBe('Invalid identity claims');
      }

      expect(directory.findUsersByIdentity).not.toHaveBeenCalled();
    });

    it('rejects getters and throwing proxies without executing getters or leaking errors', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      let getterExecuted = false;
      const hostileClaims = {
        get identityProvider() {
          getterExecuted = true;
          return 'prov';
        },
        identitySubject: 'sub',
      };

      await expect(resolveVerifiedIdentity({ claims: hostileClaims }, deps)).rejects.toThrow(
        IdentityClaimsValidationError,
      );
      expect(getterExecuted).toBe(false);
      expect(directory.findUsersByIdentity).not.toHaveBeenCalled();
    });
  });

  describe('Existing User Resolution', () => {
    it('returns frozen principal for active existing user without clock or ID generation', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      const existingUser = createValidActiveSnapshot();
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([existingUser]);

      const principal: ApplicationPrincipal = await resolveVerifiedIdentity(
        { claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' } },
        deps,
      );

      expect(directory.findUsersByIdentity).toHaveBeenCalledTimes(1);
      expect(directory.findUsersByIdentity).toHaveBeenCalledWith({
        identityProvider: 'https://auth.example.com',
        identitySubject: 'sub-12345',
      });
      expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
      expect(clock.now).not.toHaveBeenCalled();
      expect(idGenerator.generateUserId).not.toHaveBeenCalled();

      expect(principal.user).toEqual(existingUser);
      expect(principal.user).not.toBe(existingUser);
      expect(principal.authenticationSource.kind).toBe('verified_oidc');
      expect(principal.authenticationSource.identityProvider).toBe('https://auth.example.com');
      expect(Object.isFrozen(principal)).toBe(true);
      expect(Object.isFrozen(principal.authenticationSource)).toBe(true);
    });

    it('throws IdentityUnavailableError without user/metadata fields for disabled and deletion_pending users', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      // Disabled user
      const disabledUser = createValidActiveSnapshot({ status: 'disabled' });
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([disabledUser]);

      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityUnavailableError);

      try {
        await resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        );
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityUnavailableError);
        const unavailErr = err as Record<string, unknown>;
        expect(unavailErr.code).toBe('IDENTITY_UNAVAILABLE');
        expect(unavailErr.userId).toBeUndefined();
        expect(unavailErr.status).toBeUndefined();
        expect(unavailErr.identityProvider).toBeUndefined();
        expect(unavailErr.identitySubject).toBeUndefined();
      }

      // Deletion pending user
      const deletionUser = createValidActiveSnapshot({ status: 'deletion_pending' });
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([deletionUser]);

      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityUnavailableError);

      expect(clock.now).not.toHaveBeenCalled();
      expect(idGenerator.generateUserId).not.toHaveBeenCalled();
      expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
    });

    it('rejects multiple users returned from lookup with IdentityPersistenceError("lookup")', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      const user1 = createValidActiveSnapshot();
      const user2 = createValidActiveSnapshot({
        id: parseUserId('018f6c38-7654-7123-8abc-def012345679'),
      });
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([user1, user2]);

      try {
        await resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        );
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityPersistenceError);
        const persistErr = err as IdentityPersistenceError;
        expect(persistErr.operation).toBe('lookup');
      }

      expect(clock.now).not.toHaveBeenCalled();
      expect(idGenerator.generateUserId).not.toHaveBeenCalled();
      expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
    });

    it('rejects mismatched identity returned from lookup with IdentityPersistenceError("lookup")', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      const mismatched = createValidActiveSnapshot({ identitySubject: 'other-subject' });
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([mismatched]);

      try {
        await resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        );
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityPersistenceError);
        expect((err as IdentityPersistenceError).operation).toBe('lookup');
      }
    });
  });

  describe('New User Provisioning Path', () => {
    it('provisions new active version-1 user when lookup returns 0 users', async () => {
      const clock = createMockClock('2026-11-01T12:00:00.000Z');
      const idGenerator = createMockIdGenerator('018f6c38-7654-7123-8abc-def012345678');
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([]);

      const createdSnapshot = createValidActiveSnapshot({
        id: parseUserId('018f6c38-7654-7123-8abc-def012345678'),
        identityProvider: 'https://auth.example.com',
        identitySubject: 'sub-new',
        email: 'newuser@example.com',
        displayName: 'New User',
        status: 'active',
        createdAt: parseIsoTimestamp('2026-11-01T12:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-01T12:00:00.000Z'),
        version: 1,
      });

      vi.mocked(directory.insertUserIfAbsent).mockResolvedValue(createdSnapshot);

      const principal = await resolveVerifiedIdentity(
        {
          claims: {
            identityProvider: 'https://auth.example.com',
            identitySubject: 'sub-new',
            email: '  newuser@example.com  ',
            displayName: '  New User  ',
          },
        },
        deps,
      );

      expect(directory.findUsersByIdentity).toHaveBeenCalledTimes(1);
      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(idGenerator.generateUserId).toHaveBeenCalledTimes(1);
      expect(directory.insertUserIfAbsent).toHaveBeenCalledTimes(1);

      const insertCallArg = vi.mocked(directory.insertUserIfAbsent).mock.calls[0]![0].user;
      expect(insertCallArg.id).toBe('018f6c38-7654-7123-8abc-def012345678');
      expect(insertCallArg.identityProvider).toBe('https://auth.example.com');
      expect(insertCallArg.identitySubject).toBe('sub-new');
      expect(insertCallArg.email).toBe('newuser@example.com');
      expect(insertCallArg.displayName).toBe('New User');
      expect(insertCallArg.status).toBe('active');
      expect(insertCallArg.createdAt).toBe('2026-11-01T12:00:00.000Z');
      expect(insertCallArg.updatedAt).toBe('2026-11-01T12:00:00.000Z');
      expect(insertCallArg.version).toBe(1);
      expect(Object.isFrozen(insertCallArg)).toBe(true);

      expect(principal.user).toEqual(createdSnapshot);
      expect(principal.user).not.toBe(createdSnapshot);
      expect(principal.authenticationSource.identityProvider).toBe('https://auth.example.com');
    });

    it('fails before ID generation and insert when clock returns invalid Date', async () => {
      const clock: ClockPort = { now: vi.fn(() => new Date('invalid date')) };
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([]);

      await expect(
        resolveVerifiedIdentity(
          { claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-new' } },
          deps,
        ),
      ).rejects.toThrow(ValidationError);

      expect(idGenerator.generateUserId).not.toHaveBeenCalled();
      expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
    });

    it('fails before insert when ID generator throws', async () => {
      const clock = createMockClock();
      const idGenerator: IdGeneratorPort = {
        generateWorkspaceId: vi.fn(),
        generateMembershipId: vi.fn(),
        generateUserId: vi.fn(() => {
          throw new Error('Entropy generator failure');
        }),
      };
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([]);

      await expect(
        resolveVerifiedIdentity(
          { claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-new' } },
          deps,
        ),
      ).rejects.toThrow('Entropy generator failure');

      expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
    });

    it('rejects inserted result mismatch or invalid status with IdentityPersistenceError("insert")', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([]);

      // Returned inactive user from insert
      const inactiveInsert = createValidActiveSnapshot({ status: 'disabled' });
      vi.mocked(directory.insertUserIfAbsent).mockResolvedValue(inactiveInsert);

      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);
    });
  });

  describe('Losing-Race Recovery Path', () => {
    it('recovers active user after insert returns null (ON CONFLICT DO NOTHING)', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      const existingWinner = createValidActiveSnapshot();

      // First lookup: 0 users (miss)
      // Insert: null (another process won conflict)
      // Recovery lookup: returns winning user
      vi.mocked(directory.findUsersByIdentity)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([existingWinner]);
      vi.mocked(directory.insertUserIfAbsent).mockResolvedValueOnce(null);

      const principal = await resolveVerifiedIdentity(
        { claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' } },
        deps,
      );

      expect(directory.findUsersByIdentity).toHaveBeenCalledTimes(2);
      expect(directory.insertUserIfAbsent).toHaveBeenCalledTimes(1); // Never retried
      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(idGenerator.generateUserId).toHaveBeenCalledTimes(1);

      expect(principal.user).toEqual(existingWinner);
      expect(principal.user).not.toBe(existingWinner);
    });

    it('throws IdentityProvisioningRaceError with retryable=true when recovery lookup returns 0 rows', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      vi.mocked(directory.insertUserIfAbsent).mockResolvedValueOnce(null);

      try {
        await resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        );
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityProvisioningRaceError);
        const raceErr = err as IdentityProvisioningRaceError;
        expect(raceErr.code).toBe('IDENTITY_PROVISIONING_RACE');
        expect(raceErr.retryable).toBe(true);
      }
    });

    it('throws IdentityUnavailableError when recovered user is disabled or deletion_pending', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      const disabledWinner = createValidActiveSnapshot({ status: 'disabled' });
      vi.mocked(directory.findUsersByIdentity)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([disabledWinner]);
      vi.mocked(directory.insertUserIfAbsent).mockResolvedValueOnce(null);

      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityUnavailableError);
    });

    it('throws IdentityPersistenceError("recovery") when recovery returns multiple or malformed users', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      const u1 = createValidActiveSnapshot();
      const u2 = createValidActiveSnapshot({
        id: parseUserId('018f6c38-7654-7123-8abc-def012345679'),
      });
      vi.mocked(directory.findUsersByIdentity)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([u1, u2]);
      vi.mocked(directory.insertUserIfAbsent).mockResolvedValueOnce(null);

      try {
        await resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        );
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IdentityPersistenceError);
        expect((err as IdentityPersistenceError).operation).toBe('recovery');
      }
    });
  });

  describe('Hostile Persistence Result Validation & Proxy Safety', () => {
    it('rejects proxy lookup array immediately with zero traps executed', async () => {
      let trapsCalled = 0;
      const handler: ProxyHandler<UserSnapshot[]> = {
        get(_t, prop) {
          if (prop === 'then') return undefined;
          trapsCalled++;
          throw new Error('TRAP_GET');
        },
        getOwnPropertyDescriptor() {
          trapsCalled++;
          throw new Error('TRAP_DESC');
        },
        getPrototypeOf() {
          trapsCalled++;
          throw new Error('TRAP_PROTO');
        },
        ownKeys() {
          trapsCalled++;
          throw new Error('TRAP_OWNKEYS');
        },
        has() {
          trapsCalled++;
          throw new Error('TRAP_HAS');
        },
      };
      const proxyArray = new Proxy([createValidActiveSnapshot()], handler);

      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue(
        proxyArray as unknown as readonly UserSnapshot[],
      );

      let thrownErr: unknown;
      try {
        await resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        );
      } catch (e) {
        thrownErr = e;
      }

      expect(thrownErr).toBeInstanceOf(IdentityPersistenceError);
      expect((thrownErr as IdentityPersistenceError).operation).toBe('lookup');
      expect((thrownErr as IdentityPersistenceError).message).toBe('Identity persistence error');
      expect(trapsCalled).toBe(0);

      expect(clock.now).not.toHaveBeenCalled();
      expect(idGenerator.generateUserId).not.toHaveBeenCalled();
      expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
    });

    it('rejects revoked proxy lookup array safely', async () => {
      let trapsCalled = 0;
      const { proxy, revoke } = Proxy.revocable([createValidActiveSnapshot()], {
        get(_t, prop) {
          if (prop === 'then') return undefined;
          trapsCalled++;
          throw new Error('TRAP_GET');
        },
      });
      const promise = Promise.resolve(proxy as unknown as readonly UserSnapshot[]);
      revoke();

      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockReturnValue(promise);

      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);
      expect(trapsCalled).toBe(0);
    });

    it('rejects array subclasses, sparse arrays, symbol-bearing arrays, and extra-key arrays', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      // Array subclass
      class HostileArray extends Array {}
      const subclassArr = new HostileArray();
      subclassArr.push(createValidActiveSnapshot());

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue(
        subclassArr as unknown as readonly UserSnapshot[],
      );
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);

      // Sparse array
      const sparseArr: unknown[] = [];
      sparseArr[1] = createValidActiveSnapshot();
      sparseArr.length = 2;
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue(
        sparseArr as unknown as readonly UserSnapshot[],
      );
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);

      // Symbol property on array
      const symbolArr = [createValidActiveSnapshot()];
      (symbolArr as unknown as Record<symbol, unknown>)[Symbol('hostile')] = 'secret';
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue(
        symbolArr as unknown as readonly UserSnapshot[],
      );
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);

      // Extra property on array
      const extraArr = [createValidActiveSnapshot()];
      (extraArr as unknown as Record<string, unknown>).extra = 'forbidden';
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue(
        extraArr as unknown as readonly UserSnapshot[],
      );
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);

      // Accessor index on array
      const accessorArr: unknown[] = [];
      let accessorCalled = false;
      Object.defineProperty(accessorArr, '0', {
        get() {
          accessorCalled = true;
          return createValidActiveSnapshot();
        },
        enumerable: true,
        configurable: true,
      });
      accessorArr.length = 1;
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue(
        accessorArr as unknown as readonly UserSnapshot[],
      );
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);
      expect(accessorCalled).toBe(false);
    });

    describe('Persistence Array Validation & Prototype Spoofing Rejection Matrix', () => {
      const createInvalidArrays = () => {
        const validSnapshot = createValidActiveSnapshot();

        // 1. Object.create(Array.prototype) with length: 0
        const makeSpoofed0 = () => {
          const spoofed0 = Object.create(Array.prototype);
          Object.defineProperty(spoofed0, 'length', {
            value: 0,
            writable: true,
            enumerable: false,
            configurable: false,
          });
          return { value: spoofed0, getTraps: () => 0 };
        };

        // 2. Object.create(Array.prototype) with length: 1 and valid snapshot
        const makeSpoofed1 = () => {
          const spoofed1 = Object.create(Array.prototype);
          Object.defineProperty(spoofed1, 'length', {
            value: 1,
            writable: true,
            enumerable: false,
            configurable: false,
          });
          Object.defineProperty(spoofed1, '0', {
            value: validSnapshot,
            writable: true,
            enumerable: true,
            configurable: true,
          });
          return { value: spoofed1, getTraps: () => 0 };
        };

        // 3. Ordinary array-like object with Object.prototype
        const makeOrdinaryArrayLike = () => {
          const ordinaryArrayLike = {
            length: 1,
            0: validSnapshot,
          };
          return { value: ordinaryArrayLike, getTraps: () => 0 };
        };

        // 4. Copied descriptors on plain object
        const makeCopiedDescriptors = () => {
          const copiedDescriptors = Object.create(Object.prototype);
          Object.defineProperty(copiedDescriptors, 'length', {
            value: 1,
            writable: true,
            enumerable: false,
            configurable: false,
          });
          Object.defineProperty(copiedDescriptors, '0', {
            value: validSnapshot,
            writable: true,
            enumerable: true,
            configurable: true,
          });
          return { value: copiedDescriptors, getTraps: () => 0 };
        };

        // 5. Iterable / SDK collection
        const makeSdkCollection = () => {
          const sdkCollection = {
            length: 1,
            0: validSnapshot,
            [Symbol.iterator]: function* () {
              yield validSnapshot;
            },
          };
          return { value: sdkCollection, getTraps: () => 0 };
        };

        // 6. Array subclass
        const makeSubclass = () => {
          class MyArraySubclass extends Array {}
          const subclass = new MyArraySubclass();
          subclass.push(validSnapshot);
          return { value: subclass, getTraps: () => 0 };
        };

        // 7. Proxy array with throwing traps
        const makeProxyArray = () => {
          let proxyTrapCalled = false;
          const proxyArray = new Proxy([validSnapshot], {
            get(_t, p) {
              if (p === 'then') return undefined;
              proxyTrapCalled = true;
              throw new Error('PROXY_TRAP');
            },
            getPrototypeOf() {
              proxyTrapCalled = true;
              throw new Error('PROXY_TRAP');
            },
            ownKeys() {
              proxyTrapCalled = true;
              throw new Error('PROXY_TRAP');
            },
          });
          return { value: proxyArray, getTraps: () => (proxyTrapCalled ? 1 : 0) };
        };

        // 8. Revoked proxy array (Promise resolved before revoke so fulfillment holds revoked proxy)
        const makeRevokedProxyArray = () => {
          let revokedTrapCalled = false;
          const { proxy: revokedProxyArray, revoke } = Proxy.revocable([validSnapshot], {
            get(_t, p) {
              if (p === 'then') return undefined;
              revokedTrapCalled = true;
              throw new Error('REVOKED_PROXY_TRAP');
            },
          });
          const promise = Promise.resolve(revokedProxyArray);
          revoke();
          return { value: promise, getTraps: () => (revokedTrapCalled ? 1 : 0) };
        };

        // 9. Symbol property on genuine array
        const makeSymbolArray = () => {
          const symbolArray = [validSnapshot];
          (symbolArray as unknown as Record<symbol, unknown>)[Symbol('hostile')] = 'secret';
          return { value: symbolArray, getTraps: () => 0 };
        };

        // 10. Extra property on genuine array
        const makeExtraPropArray = () => {
          const extraPropArray = [validSnapshot];
          (extraPropArray as unknown as Record<string, unknown>).extra = 'forbidden';
          return { value: extraPropArray, getTraps: () => 0 };
        };

        // 11. Sparse array
        const makeSparseArray = () => {
          const sparseArray: unknown[] = [];
          sparseArray[1] = validSnapshot;
          sparseArray.length = 2;
          return { value: sparseArray, getTraps: () => 0 };
        };

        // 12. Accessor index on genuine array
        const makeAccessorArray = () => {
          let accessorCalled = false;
          const accessorArray: unknown[] = [];
          Object.defineProperty(accessorArray, '0', {
            get() {
              accessorCalled = true;
              return validSnapshot;
            },
            enumerable: true,
            configurable: true,
          });
          Object.defineProperty(accessorArray, 'length', { value: 1, writable: true });
          return { value: accessorArray, getTraps: () => (accessorCalled ? 1 : 0) };
        };

        return [
          { name: 'Object.create(Array.prototype) length: 0', factory: makeSpoofed0 },
          { name: 'Object.create(Array.prototype) length: 1', factory: makeSpoofed1 },
          { name: 'ordinary array-like object', factory: makeOrdinaryArrayLike },
          { name: 'object with copied array descriptors', factory: makeCopiedDescriptors },
          { name: 'iterable/SDK collection object', factory: makeSdkCollection },
          { name: 'array subclass instance', factory: makeSubclass },
          { name: 'proxy array', factory: makeProxyArray },
          { name: 'revoked proxy array', factory: makeRevokedProxyArray },
          { name: 'symbol-bearing array', factory: makeSymbolArray },
          { name: 'extra property array', factory: makeExtraPropArray },
          { name: 'sparse array', factory: makeSparseArray },
          { name: 'accessor index array', factory: makeAccessorArray },
        ];
      };

      it('rejects every spoofed/invalid array during initial lookup with IdentityPersistenceError("lookup") and exact call counts', async () => {
        for (const item of createInvalidArrays()) {
          const clock = createMockClock();
          const idGenerator = createMockIdGenerator();
          const directory = createMockDirectory();
          const deps: ResolveVerifiedIdentityDependencies = {
            clock,
            idGenerator,
            identityDirectory: directory,
          };

          const instance1 = item.factory();
          vi.mocked(directory.findUsersByIdentity).mockReturnValue(
            Promise.resolve(instance1.value as unknown as readonly UserSnapshot[]),
          );

          let caught1: unknown;
          try {
            await resolveVerifiedIdentity(
              {
                claims: {
                  identityProvider: 'https://auth.example.com',
                  identitySubject: 'sub-12345',
                },
              },
              deps,
            );
          } catch (err) {
            caught1 = err;
          }

          // Test fresh error identity with second invocation
          const instance2 = item.factory();
          vi.mocked(directory.findUsersByIdentity).mockReturnValue(
            Promise.resolve(instance2.value as unknown as readonly UserSnapshot[]),
          );
          let caught2: unknown;
          try {
            await resolveVerifiedIdentity(
              {
                claims: {
                  identityProvider: 'https://auth.example.com',
                  identitySubject: 'sub-12345',
                },
              },
              deps,
            );
          } catch (err) {
            caught2 = err;
          }

          expect(caught1).toBeInstanceOf(IdentityPersistenceError);
          const err1 = caught1 as IdentityPersistenceError;
          expect(err1.operation).toBe('lookup');
          expect(err1.message).toBe('Identity persistence error');
          expect(caught1).not.toBe(caught2); // fresh error identity

          expect(instance1.getTraps()).toBe(0);
          expect(instance2.getTraps()).toBe(0);
          expect(directory.findUsersByIdentity).toHaveBeenCalledTimes(2); // 1 per call
          expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
          expect(clock.now).not.toHaveBeenCalled();
          expect(idGenerator.generateUserId).not.toHaveBeenCalled();
        }
      });

      it('rejects every spoofed/invalid array during losing-race recovery with IdentityPersistenceError("recovery") and exact call counts', async () => {
        for (const item of createInvalidArrays()) {
          const clock = createMockClock();
          const idGenerator = createMockIdGenerator();
          const directory = createMockDirectory();
          const deps: ResolveVerifiedIdentityDependencies = {
            clock,
            idGenerator,
            identityDirectory: directory,
          };

          // First invocation: initial lookup [] -> insert null -> recovery invalid array
          const instance1 = item.factory();
          vi.mocked(directory.findUsersByIdentity)
            .mockResolvedValueOnce([])
            .mockReturnValueOnce(
              Promise.resolve(instance1.value as unknown as readonly UserSnapshot[]),
            );
          vi.mocked(directory.insertUserIfAbsent).mockResolvedValueOnce(null);

          let caught1: unknown;
          try {
            await resolveVerifiedIdentity(
              {
                claims: {
                  identityProvider: 'https://auth.example.com',
                  identitySubject: 'sub-12345',
                },
              },
              deps,
            );
          } catch (err) {
            caught1 = err;
          }

          // Second invocation: fresh error identity
          const instance2 = item.factory();
          vi.mocked(directory.findUsersByIdentity)
            .mockResolvedValueOnce([])
            .mockReturnValueOnce(
              Promise.resolve(instance2.value as unknown as readonly UserSnapshot[]),
            );
          vi.mocked(directory.insertUserIfAbsent).mockResolvedValueOnce(null);

          let caught2: unknown;
          try {
            await resolveVerifiedIdentity(
              {
                claims: {
                  identityProvider: 'https://auth.example.com',
                  identitySubject: 'sub-12345',
                },
              },
              deps,
            );
          } catch (err) {
            caught2 = err;
          }

          expect(caught1).toBeInstanceOf(IdentityPersistenceError);
          const err1 = caught1 as IdentityPersistenceError;
          expect(err1.operation).toBe('recovery');
          expect(err1.message).toBe('Identity persistence error');
          expect(caught1).not.toBe(caught2); // fresh error identity

          expect(instance1.getTraps()).toBe(0);
          expect(instance2.getTraps()).toBe(0);
          // Initial lookup + recovery lookup = exactly 2 lookups per invocation (4 total)
          expect(directory.findUsersByIdentity).toHaveBeenCalledTimes(4);
          expect(clock.now).toHaveBeenCalledTimes(2);
          expect(idGenerator.generateUserId).toHaveBeenCalledTimes(2);
          expect(directory.insertUserIfAbsent).toHaveBeenCalledTimes(2);
        }
      });
    });

    it('rejects proxy snapshots, mutable snapshots, and snapshots with custom prototypes', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      // Proxy snapshot
      let trapCalled = false;
      const proxySnapshot = new Proxy(createValidActiveSnapshot(), {
        get(t, p) {
          if (p === 'then') return undefined;
          trapCalled = true;
          return Reflect.get(t, p);
        },
      });
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([
        proxySnapshot as unknown as UserSnapshot,
      ]);
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);
      expect(trapCalled).toBe(false);

      // Unfrozen (mutable) snapshot
      const unfrozenSnapshot = { ...createValidActiveSnapshot() };
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([
        unfrozenSnapshot as unknown as UserSnapshot,
      ]);
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);

      // Custom prototype snapshot
      class HostileSnapshot {}
      const customProtoSnapshot = Object.assign(new HostileSnapshot(), createValidActiveSnapshot());
      Object.freeze(customProtoSnapshot);
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([
        customProtoSnapshot as unknown as UserSnapshot,
      ]);
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);

      // Snapshot with getter descriptor (never executes)
      let getterRan = false;
      const getterSnapshot = {
        id: parseUserId('018f6c38-7654-7123-8abc-def012345678'),
        identityProvider: 'https://auth.example.com',
        identitySubject: 'sub-12345',
        email: null,
        displayName: null,
        get status() {
          getterRan = true;
          return 'active';
        },
        createdAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-01T00:00:00.000Z'),
        version: 1,
      };
      Object.freeze(getterSnapshot);
      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([
        getterSnapshot as unknown as UserSnapshot,
      ]);
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);
      expect(getterRan).toBe(false);
    });

    it('rejects hostile snapshots with toString, valueOf, toJSON hooks without executing them', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      let hookExecuted = false;
      const hostileHook = {
        toString() {
          hookExecuted = true;
          return 'hook';
        },
        valueOf() {
          hookExecuted = true;
          return 1;
        },
        toJSON() {
          hookExecuted = true;
          return {};
        },
      };

      const hostileSnapshot = Object.freeze({
        ...createValidActiveSnapshot(),
        email: hostileHook,
      });

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([
        hostileSnapshot as unknown as UserSnapshot,
      ]);
      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);
      expect(hookExecuted).toBe(false);
    });

    it('applies the exact snapshot descriptor validation rules to insert results and recovery results', async () => {
      const clock = createMockClock();
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      // Insert result: proxy-backed
      vi.mocked(directory.findUsersByIdentity).mockResolvedValueOnce([]);
      let insertTrap = false;
      const proxyInserted = new Proxy(createValidActiveSnapshot(), {
        get(t, p) {
          if (p === 'then') return undefined;
          insertTrap = true;
          return Reflect.get(t, p);
        },
      });
      vi.mocked(directory.insertUserIfAbsent).mockResolvedValueOnce(
        proxyInserted as unknown as UserSnapshot,
      );

      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);
      expect(insertTrap).toBe(false);
      expect(directory.findUsersByIdentity).toHaveBeenCalledTimes(1); // No recovery called on insert inspection failure!

      // Recovery result: proxy array
      vi.mocked(directory.findUsersByIdentity).mockReset();
      vi.mocked(directory.insertUserIfAbsent).mockReset();
      vi.mocked(directory.findUsersByIdentity)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(
          new Proxy([createValidActiveSnapshot()], {
            get(_t, p) {
              if (p === 'then') return undefined;
              throw new Error('RECOVERY_TRAP');
            },
          }) as unknown as readonly UserSnapshot[],
        );
      vi.mocked(directory.insertUserIfAbsent).mockResolvedValueOnce(null);

      await expect(
        resolveVerifiedIdentity(
          {
            claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-12345' },
          },
          deps,
        ),
      ).rejects.toThrow(IdentityPersistenceError);
    });
  });

  describe('Hostile Clock Validation & Trusted Intrinsic Safety', () => {
    it('rejects primitives, arrays, functions, symbols, and objects returned from clock', async () => {
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock: { now: vi.fn() },
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([]);

      const invalidClockValues = [
        null,
        undefined,
        1234567890,
        '2026-11-01T00:00:00.000Z',
        true,
        [],
        () => new Date(),
        Symbol('clock'),
        1000n,
        { getTime: () => Date.now() },
      ];

      for (const val of invalidClockValues) {
        vi.mocked(deps.clock.now).mockReturnValue(val as unknown as Date);

        let thrown: unknown;
        try {
          await resolveVerifiedIdentity(
            {
              claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-new' },
            },
            deps,
          );
        } catch (e) {
          thrown = e;
        }

        expect(thrown).toBeInstanceOf(ValidationError);
        const valErr = thrown as ValidationError;
        expect(valErr.field).toBe('clock');
        expect(valErr.message).toBe('Invalid clock value');
        expect(idGenerator.generateUserId).not.toHaveBeenCalled();
        expect(directory.insertUserIfAbsent).not.toHaveBeenCalled();
      }
    });

    it('rejects genuine Date with overridden own getTime, toISOString, or valueOf without executing them', async () => {
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock: { now: vi.fn() },
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([]);

      let ownGetTimeExecuted = false;
      const hostileDate = new Date('2026-11-01T00:00:00.000Z');
      hostileDate.getTime = () => {
        ownGetTimeExecuted = true;
        throw new Error('HOSTILE_GETTIME');
      };

      vi.mocked(deps.clock.now).mockReturnValue(hostileDate);

      let thrown: unknown;
      try {
        await resolveVerifiedIdentity(
          { claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-new' } },
          deps,
        );
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(ValidationError);
      expect((thrown as ValidationError).field).toBe('clock');
      expect((thrown as ValidationError).message).toBe('Invalid clock value');
      expect(ownGetTimeExecuted).toBe(false);
      expect(idGenerator.generateUserId).not.toHaveBeenCalled();
    });

    it('rejects Date subclasses and proxy Dates returned from clock', async () => {
      const idGenerator = createMockIdGenerator();
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock: { now: vi.fn() },
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([]);

      // Date subclass
      class CustomDate extends Date {}
      vi.mocked(deps.clock.now).mockReturnValue(new CustomDate());
      await expect(
        resolveVerifiedIdentity(
          { claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-new' } },
          deps,
        ),
      ).rejects.toThrow(ValidationError);

      // Proxy Date with throwing traps
      let dateTrapCalled = false;
      const proxyDate = new Proxy(new Date(), {
        get(t, p) {
          dateTrapCalled = true;
          return Reflect.get(t, p);
        },
      });
      vi.mocked(deps.clock.now).mockReturnValue(proxyDate);
      await expect(
        resolveVerifiedIdentity(
          { claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-new' } },
          deps,
        ),
      ).rejects.toThrow(ValidationError);
      expect(dateTrapCalled).toBe(false);
    });

    it('proves valid genuine Date produces exact canonical timestamp and caller Date is dropped', async () => {
      const mutableDate = new Date('2026-11-01T15:30:00.000Z');
      const clock: ClockPort = { now: vi.fn(() => mutableDate) };
      const idGenerator = createMockIdGenerator('018f6c38-7654-7123-8abc-def012345678');
      const directory = createMockDirectory();
      const deps: ResolveVerifiedIdentityDependencies = {
        clock,
        idGenerator,
        identityDirectory: directory,
      };

      vi.mocked(directory.findUsersByIdentity).mockResolvedValue([]);
      vi.mocked(directory.insertUserIfAbsent).mockImplementation(async ({ user }) => user);

      const principal = await resolveVerifiedIdentity(
        { claims: { identityProvider: 'https://auth.example.com', identitySubject: 'sub-new' } },
        deps,
      );

      expect(principal.user.createdAt).toBe('2026-11-01T15:30:00.000Z');
      expect(principal.user.updatedAt).toBe('2026-11-01T15:30:00.000Z');

      // Mutate original caller-owned Date
      mutableDate.setFullYear(2000);
      expect(principal.user.createdAt).toBe('2026-11-01T15:30:00.000Z');
    });
  });

  describe('Child-Process Non-Disclosure Tests', () => {
    it('proves hostile lookup array sentinels never leak to child process stdout or stderr', async () => {
      const { spawn } = await import('node:child_process');
      const sentinel = 'SECRET_LOOKUP_SENTINEL_112233';
      const childScript = `
        import { resolveVerifiedIdentity } from './packages/application/src/resolve-verified-identity.ts';
        import util from 'node:util';

        const throwingArray = new Proxy([{}], {
          get(t, prop) {
            if (prop === 'length') throw new Error('${sentinel}');
            return Reflect.get(t, prop);
          }
        });

        try {
          await resolveVerifiedIdentity(
            { claims: { identityProvider: 'https://issuer.com', identitySubject: 'sub1' } },
            {
              identityDirectory: {
                findUsersByIdentity: async () => throwingArray as any,
                insertUserIfAbsent: async () => null,
              },
              clock: { now: () => new Date() },
              idGenerator: {
                generateUserId: () => '018f6c38-7654-7123-8abc-def012345678' as any,
                generateWorkspaceId: () => '' as any,
                generateMembershipId: () => '' as any,
              },
            }
          );
          process.exit(1);
        } catch (err: any) {
          const str = String(err);
          const json = JSON.stringify(err);
          const insp1 = util.inspect(err, { customInspect: true });
          const insp2 = util.inspect(err, { customInspect: false });
          const out = str + json + insp1 + insp2 + (err.stack ?? '');
          if (out.includes('${sentinel}')) {
            process.exit(2);
          }
          process.exit(0);
        }
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain(sentinel);
      expect(stderr).not.toContain(sentinel);
    }, 15000);

    it('proves hostile clock Date sentinels never leak to child process stdout or stderr', async () => {
      const { spawn } = await import('node:child_process');
      const sentinel = 'SECRET_CLOCK_SENTINEL_445566';
      const childScript = `
        import { resolveVerifiedIdentity } from './packages/application/src/resolve-verified-identity.ts';
        import util from 'node:util';

        const hostileDate = new Date();
        hostileDate.getTime = () => { throw new Error('${sentinel}'); };

        try {
          await resolveVerifiedIdentity(
            { claims: { identityProvider: 'https://issuer.com', identitySubject: 'sub1' } },
            {
              identityDirectory: {
                findUsersByIdentity: async () => [],
                insertUserIfAbsent: async () => null,
              },
              clock: { now: () => hostileDate },
              idGenerator: {
                generateUserId: () => '018f6c38-7654-7123-8abc-def012345678' as any,
                generateWorkspaceId: () => '' as any,
                generateMembershipId: () => '' as any,
              },
            }
          );
          process.exit(1);
        } catch (err: any) {
          const str = String(err);
          const json = JSON.stringify(err);
          const insp1 = util.inspect(err, { customInspect: true });
          const insp2 = util.inspect(err, { customInspect: false });
          const out = str + json + insp1 + insp2 + (err.stack ?? '');
          if (out.includes('${sentinel}')) {
            process.exit(2);
          }
          process.exit(0);
        }
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain(sentinel);
      expect(stderr).not.toContain(sentinel);
    }, 15000);

    it('proves hostile proxy claims sentinels never leak to child process stdout, stderr, or inspect', async () => {
      const { spawn } = await import('node:child_process');
      const sentinel = 'SECRET_CLAIMS_SENTINEL_778899';
      const childScript = `
        import { resolveVerifiedIdentity } from './packages/application/src/resolve-verified-identity.ts';
        import util from 'node:util';

        let trapCount = 0;
        let hookCount = 0;
        const target = {
          identityProvider: 'https://issuer.com',
          identitySubject: 'sub1',
          toString() { hookCount++; throw new Error('${sentinel}'); },
          valueOf() { hookCount++; throw new Error('${sentinel}'); },
          toJSON() { hookCount++; throw new Error('${sentinel}'); },
          [Symbol.for('nodejs.util.inspect.custom')]() { hookCount++; throw new Error('${sentinel}'); },
        };
        const hostileProxy = new Proxy(target, {
          get() { trapCount++; throw new Error('${sentinel}'); },
          getPrototypeOf() { trapCount++; throw new Error('${sentinel}'); },
          ownKeys() { trapCount++; throw new Error('${sentinel}'); },
          getOwnPropertyDescriptor() { trapCount++; throw new Error('${sentinel}'); },
          has() { trapCount++; throw new Error('${sentinel}'); },
          set() { trapCount++; throw new Error('${sentinel}'); },
        });

        let dependencyCalls = 0;
        try {
          await resolveVerifiedIdentity(
            { claims: hostileProxy },
            {
              identityDirectory: {
                findUsersByIdentity: async () => { dependencyCalls++; return []; },
                insertUserIfAbsent: async () => { dependencyCalls++; return null; },
              },
              clock: { now: () => { dependencyCalls++; return new Date(); } },
              idGenerator: {
                generateUserId: () => { dependencyCalls++; return '018f6c38-7654-7123-8abc-def012345678' as any; },
                generateWorkspaceId: () => '' as any,
                generateMembershipId: () => '' as any,
              },
            }
          );
          process.exit(1);
        } catch (err: any) {
          if (trapCount !== 0 || hookCount !== 0 || dependencyCalls !== 0) {
            process.exit(3);
          }
          if (err.name !== 'IdentityClaimsValidationError' || err.code !== 'IDENTITY_CLAIMS_INVALID' || err.field !== 'claims' || err.message !== 'Invalid identity claims') {
            process.exit(4);
          }
          const str = String(err);
          const json = JSON.stringify(err);
          const insp1 = util.inspect(err, { customInspect: true });
          const insp2 = util.inspect(err, { customInspect: false });
          const keys = Object.keys(err).join(',');
          const ownKeys = Reflect.ownKeys(err).map(String).join(',');
          const out = str + json + insp1 + insp2 + (err.stack ?? '') + keys + ownKeys;
          if (out.includes('${sentinel}')) {
            process.exit(2);
          }
          process.exit(0);
        }
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain(sentinel);
      expect(stderr).not.toContain(sentinel);
    }, 15000);

    it('proves spoofed persistence array Object.create(Array.prototype) sentinels never leak to child process stdout, stderr, or inspect', async () => {
      const { spawn } = await import('node:child_process');
      const sentinel = 'SECRET_SPOOFED_ARRAY_SENTINEL_334455';
      const childScript = `
        import { resolveVerifiedIdentity } from './packages/application/src/resolve-verified-identity.ts';
        import util from 'node:util';

        let getterCount = 0;
        const fakeArr = Object.create(Array.prototype);
        Object.defineProperty(fakeArr, 'length', {
          value: 1,
          writable: true,
          enumerable: false,
          configurable: false,
        });
        Object.defineProperty(fakeArr, '0', {
          get() {
            getterCount++;
            throw new Error('${sentinel}');
          },
          enumerable: true,
          configurable: true,
        });

        let lookupCalls = 0;
        let otherCalls = 0;
        try {
          await resolveVerifiedIdentity(
            { claims: { identityProvider: 'https://issuer.com', identitySubject: 'sub1' } },
            {
              identityDirectory: {
                findUsersByIdentity: async () => { lookupCalls++; return fakeArr; },
                insertUserIfAbsent: async () => { otherCalls++; return null; },
              },
              clock: { now: () => { otherCalls++; return new Date(); } },
              idGenerator: {
                generateUserId: () => { otherCalls++; return '018f6c38-7654-7123-8abc-def012345678' as any; },
                generateWorkspaceId: () => '' as any,
                generateMembershipId: () => '' as any,
              },
            }
          );
          process.exit(1);
        } catch (err: any) {
          if (getterCount !== 0 || lookupCalls !== 1 || otherCalls !== 0) {
            process.exit(3);
          }
          if (err.name !== 'IdentityPersistenceError' || err.code !== 'IDENTITY_PERSISTENCE_INVALID' || err.operation !== 'lookup' || err.message !== 'Identity persistence error') {
            process.exit(4);
          }
          const str = String(err);
          const json = JSON.stringify(err);
          const insp1 = util.inspect(err, { customInspect: true });
          const insp2 = util.inspect(err, { customInspect: false });
          const keys = Object.keys(err).join(',');
          const ownKeys = Reflect.ownKeys(err).map(String).join(',');
          const out = str + json + insp1 + insp2 + (err.stack ?? '') + keys + ownKeys;
          if (out.includes('${sentinel}')) {
            process.exit(2);
          }
          process.exit(0);
        }
      `;

      const child = spawn(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', '-e', childScript],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain(sentinel);
      expect(stderr).not.toContain(sentinel);
    }, 15000);
  });
});
