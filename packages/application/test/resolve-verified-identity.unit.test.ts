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

      expect(principal.user).toBe(existingUser);
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

      expect(principal.user).toBe(createdSnapshot);
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

      expect(principal.user).toBe(existingWinner);
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
});
