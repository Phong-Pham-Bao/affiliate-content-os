import { describe, expect, it, vi } from 'vitest';
import {
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
    generateWorkspaceId: vi.fn(),
    generateMembershipId: vi.fn(),
    generateUserId: vi.fn(() => parseUserId(userId)),
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
  });
});
