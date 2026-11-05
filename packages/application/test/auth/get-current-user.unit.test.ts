import { describe, expect, it, vi } from 'vitest';
import { parseIsoTimestamp, parseUserId } from '@affiliate-content-os/domain';
import { getCurrentUser } from '../../src/auth/get-current-user.js';
import { AuthenticationRequiredError } from '../../src/auth/errors.js';
import type { AuthenticatedSessionContext } from '../../src/auth/authenticate-session.js';
import type { WorkspaceSummaryPort } from '../../src/auth/ports.js';

describe('packages/application - getCurrentUser', () => {
  const sampleUserId = '0192b012-3456-789a-8bcd-ef0123456710';
  const sampleContext: AuthenticatedSessionContext = {
    user: {
      id: parseUserId(sampleUserId),
      identityProvider: 'https://auth.example.com',
      identitySubject: 'sub-1',
      email: 'user@example.com',
      displayName: 'Example User',
      status: 'active',
      createdAt: parseIsoTimestamp('2026-11-02T10:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T10:00:00.000Z'),
      version: 1,
    },
    session: {
      id: '0192b012-3456-789a-8bcd-ef0123456720',
      userId: sampleUserId,
      idleExpiresAt: '2026-11-02T12:30:00.000Z',
      absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
    },
    rotatedToken: null,
  };

  const createMockWorkspaceSummary = () => ({
    listActiveWorkspaceSummaries: vi.fn().mockResolvedValue({
      items: [
        {
          id: '0192b012-3456-789a-8bcd-ef0123456730',
          name: 'Workspace Alpha',
          slug: 'workspace-alpha',
          timezone: 'Asia/Ho_Chi_Minh',
          role: 'owner' as const,
        },
      ],
      hasMore: false,
    }),
  });

  it('returns exactly the approved safe shape without exposing internal metadata or secrets', async () => {
    const workspaceSummary: WorkspaceSummaryPort = createMockWorkspaceSummary();
    const res = await getCurrentUser(sampleContext, { workspaceSummary });

    expect(res.user.id).toBe(sampleUserId);
    expect(res.user.email).toBe('user@example.com');
    expect(res.user.displayName).toBe('Example User');
    expect(res.session.idleExpiresAt).toBe('2026-11-02T12:30:00.000Z');
    expect(res.session.absoluteExpiresAt).toBe('2026-11-02T20:00:00.000Z');
    expect(res.workspaceAccess.items).toHaveLength(1);
    expect(res.workspaceAccess.hasMore).toBe(false);

    // Verify non-disclosure of internal metadata
    const userKeys = Object.keys(res.user);
    expect(userKeys).toEqual(['id', 'email', 'displayName']);

    const sessionKeys = Object.keys(res.session);
    expect(sessionKeys).toEqual(['idleExpiresAt', 'absoluteExpiresAt']);
    expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(1);
  });

  it('accepts valid context with null email and null displayName', async () => {
    const workspaceSummary: WorkspaceSummaryPort = createMockWorkspaceSummary();
    const ctx: AuthenticatedSessionContext = {
      ...sampleContext,
      user: {
        ...sampleContext.user,
        email: null,
        displayName: null,
      },
    };
    const res = await getCurrentUser(ctx, { workspaceSummary });
    expect(res.user.email).toBeNull();
    expect(res.user.displayName).toBeNull();
    expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(1);
  });

  it('reproduces and fixes the exact TASK-006 Remediation 03 defect', async () => {
    const workspaceSummary: WorkspaceSummaryPort = createMockWorkspaceSummary();
    const malformedContext = {
      user: {
        id: sampleUserId,
        identityProvider: 42,
        identitySubject: { sentinel: 'SENTINEL_REPRO' },
        email: 'user@example.com',
        displayName: 'Example User',
        status: 'disabled',
        createdAt: 'invalid',
        updatedAt: 'invalid',
        version: 0,
      },
      session: {
        id: '0192b012-3456-789a-8bcd-ef0123456720',
        userId: sampleUserId,
        idleExpiresAt: '2026-11-02T12:30:00.000Z',
        absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
      },
      rotatedToken: null,
    };

    let caughtError: unknown;
    try {
      await getCurrentUser(malformedContext as unknown as AuthenticatedSessionContext, {
        workspaceSummary,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(AuthenticationRequiredError);
    expect((caughtError as Error).message).toBe('Authentication required');
    expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(0);
    expect(String(caughtError)).not.toContain('SENTINEL_REPRO');
  });

  const assertMalformedUserFails = async (
    userOverride: Record<string, unknown>,
    sentinelMarker?: string,
  ) => {
    const workspaceSummary = createMockWorkspaceSummary();
    const ctx = {
      ...sampleContext,
      user: {
        ...sampleContext.user,
        ...userOverride,
      },
    };

    let caughtError: unknown;
    try {
      await getCurrentUser(ctx as unknown as AuthenticatedSessionContext, {
        workspaceSummary,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(AuthenticationRequiredError);
    expect((caughtError as Error).message).toBe('Authentication required');
    expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(0);
    if (sentinelMarker) {
      expect(String(caughtError)).not.toContain(sentinelMarker);
      expect(JSON.stringify(caughtError)).not.toContain(sentinelMarker);
    }
  };

  describe('identityProvider validation', () => {
    it.each([
      ['numeric', 42],
      ['object', { sentinel: 'IDP_SENTINEL' }],
      ['symbol', Symbol('IDP_SYM')],
      ['bigint', 42n],
      ['empty string', ''],
      ['leading whitespace', ' https://auth.example.com'],
      ['trailing whitespace', 'https://auth.example.com '],
      ['whitespace only', '   '],
    ])('rejects %s identityProvider', async (_, invalidValue) => {
      await assertMalformedUserFails({ identityProvider: invalidValue }, 'IDP_SENTINEL');
    });
  });

  describe('identitySubject validation', () => {
    it.each([
      ['numeric', 42],
      ['object', { sentinel: 'SUB_SENTINEL' }],
      ['symbol', Symbol('SUB_SYM')],
      ['bigint', 42n],
      ['empty string', ''],
      ['leading whitespace', ' sub-1'],
      ['trailing whitespace', 'sub-1 '],
      ['whitespace only', '   '],
    ])('rejects %s identitySubject', async (_, invalidValue) => {
      await assertMalformedUserFails({ identitySubject: invalidValue }, 'SUB_SENTINEL');
    });
  });

  describe('email validation', () => {
    it.each([
      ['numeric', 123],
      ['object', { sentinel: 'EMAIL_SENTINEL' }],
      ['symbol', Symbol('EMAIL_SYM')],
      ['bigint', 123n],
      ['undefined', undefined],
    ])('rejects %s email', async (_, invalidValue) => {
      await assertMalformedUserFails({ email: invalidValue }, 'EMAIL_SENTINEL');
    });

    it('rejects missing email key', async () => {
      const workspaceSummary = createMockWorkspaceSummary();
      const userWithoutEmail = { ...sampleContext.user };
      delete (userWithoutEmail as Record<string, unknown>)['email'];
      const ctx = { ...sampleContext, user: userWithoutEmail };

      await expect(
        getCurrentUser(ctx as unknown as AuthenticatedSessionContext, { workspaceSummary }),
      ).rejects.toThrow(AuthenticationRequiredError);
      expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(0);
    });
  });

  describe('displayName validation', () => {
    it.each([
      ['numeric', 123],
      ['object', { sentinel: 'NAME_SENTINEL' }],
      ['symbol', Symbol('NAME_SYM')],
      ['bigint', 123n],
      ['undefined', undefined],
    ])('rejects %s displayName', async (_, invalidValue) => {
      await assertMalformedUserFails({ displayName: invalidValue }, 'NAME_SENTINEL');
    });

    it('rejects missing displayName key', async () => {
      const workspaceSummary = createMockWorkspaceSummary();
      const userWithoutName = { ...sampleContext.user };
      delete (userWithoutName as Record<string, unknown>)['displayName'];
      const ctx = { ...sampleContext, user: userWithoutName };

      await expect(
        getCurrentUser(ctx as unknown as AuthenticatedSessionContext, { workspaceSummary }),
      ).rejects.toThrow(AuthenticationRequiredError);
      expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(0);
    });
  });

  describe('status validation', () => {
    it.each([
      ['disabled', 'disabled'],
      ['unknown', 'pending'],
      ['empty string', ''],
      ['numeric', 1],
      ['object', { sentinel: 'STATUS_SENTINEL' }],
      ['symbol', Symbol('STATUS_SYM')],
    ])('rejects %s status', async (_, invalidValue) => {
      await assertMalformedUserFails({ status: invalidValue }, 'STATUS_SENTINEL');
    });
  });

  describe('timestamp validation (createdAt, updatedAt)', () => {
    it.each([
      ['missing milliseconds', '2026-11-02T10:00:00Z'],
      ['offset format', '2026-11-02T10:00:00.000+00:00'],
      ['space separated', '2026-11-02 10:00:00.000Z'],
      ['invalid calendar date', '2026-02-30T10:00:00.000Z'],
      ['empty string', ''],
      ['numeric', 1730541600000],
      ['Date object', new Date()],
      ['hostile object', { sentinel: 'TS_SENTINEL' }],
      ['symbol', Symbol('TS_SYM')],
    ])('rejects createdAt with %s', async (_, invalidValue) => {
      await assertMalformedUserFails({ createdAt: invalidValue }, 'TS_SENTINEL');
    });

    it.each([
      ['missing milliseconds', '2026-11-02T10:00:00Z'],
      ['offset format', '2026-11-02T10:00:00.000+00:00'],
      ['space separated', '2026-11-02 10:00:00.000Z'],
      ['invalid calendar date', '2026-02-30T10:00:00.000Z'],
      ['empty string', ''],
      ['numeric', 1730541600000],
      ['Date object', new Date()],
      ['hostile object', { sentinel: 'TS_SENTINEL' }],
      ['symbol', Symbol('TS_SYM')],
    ])('rejects updatedAt with %s', async (_, invalidValue) => {
      await assertMalformedUserFails({ updatedAt: invalidValue }, 'TS_SENTINEL');
    });

    it('rejects createdAt > updatedAt', async () => {
      await assertMalformedUserFails({
        createdAt: '2026-11-02T10:00:00.001Z',
        updatedAt: '2026-11-02T10:00:00.000Z',
      });
    });
  });

  describe('version validation', () => {
    it.each([
      ['string', '1'],
      ['boolean', true],
      ['bigint', 1n],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['fractional', 1.5],
      ['zero', 0],
      ['negative', -1],
      ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
      ['object', { sentinel: 'VER_SENTINEL' }],
      ['symbol', Symbol('VER_SYM')],
    ])('rejects %s version', async (_, invalidValue) => {
      await assertMalformedUserFails({ version: invalidValue }, 'VER_SENTINEL');
    });
  });

  describe('user structure and hostile boundaries', () => {
    it('rejects accessor-backed user property with zero getter calls', async () => {
      let getterCalls = 0;
      const workspaceSummary = createMockWorkspaceSummary();
      const hostileUser = { ...sampleContext.user };
      Object.defineProperty(hostileUser, 'status', {
        get() {
          getterCalls++;
          throw new Error('STATUS_GETTER_SENTINEL');
        },
      });

      const ctx = { ...sampleContext, user: hostileUser };
      await expect(
        getCurrentUser(ctx as unknown as AuthenticatedSessionContext, { workspaceSummary }),
      ).rejects.toThrow(AuthenticationRequiredError);

      expect(getterCalls).toBe(0);
      expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(0);
    });

    it('rejects inherited user properties', async () => {
      const workspaceSummary = createMockWorkspaceSummary();
      const parent = { status: 'active' };
      const child = Object.create(parent);
      Object.assign(child, {
        id: sampleUserId,
        identityProvider: 'https://auth.example.com',
        identitySubject: 'sub-1',
        email: 'user@example.com',
        displayName: 'Example User',
        createdAt: '2026-11-02T10:00:00.000Z',
        updatedAt: '2026-11-02T10:00:00.000Z',
        version: 1,
      });

      const ctx = { ...sampleContext, user: child };
      await expect(
        getCurrentUser(ctx as unknown as AuthenticatedSessionContext, { workspaceSummary }),
      ).rejects.toThrow(AuthenticationRequiredError);
      expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(0);
    });

    it('rejects user with extra string keys', async () => {
      await assertMalformedUserFails({ extraUserKey: 'EXTRA_SENTINEL' }, 'EXTRA_SENTINEL');
    });

    it('rejects user with extra symbol keys', async () => {
      await assertMalformedUserFails({ [Symbol('hostile')]: 'SYM_SENTINEL' }, 'SYM_SENTINEL');
    });

    it('rejects hostile user proxy with zero trap calls', async () => {
      let trapCalls = 0;
      const workspaceSummary = createMockWorkspaceSummary();
      const hostileUserProxy = new Proxy(sampleContext.user, {
        getPrototypeOf() {
          trapCalls++;
          throw new Error('PROXY_TRAP_SENTINEL');
        },
      });

      const ctx = { ...sampleContext, user: hostileUserProxy };
      await expect(
        getCurrentUser(ctx as unknown as AuthenticatedSessionContext, { workspaceSummary }),
      ).rejects.toThrow(AuthenticationRequiredError);

      expect(trapCalls).toBe(0);
      expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(0);
    });

    it('rejects revoked user proxy with zero escape', async () => {
      const workspaceSummary = createMockWorkspaceSummary();
      const { proxy, revoke } = Proxy.revocable(sampleContext.user, {});
      revoke();

      const ctx = { ...sampleContext, user: proxy };
      await expect(
        getCurrentUser(ctx as unknown as AuthenticatedSessionContext, { workspaceSummary }),
      ).rejects.toThrow(AuthenticationRequiredError);
      expect(workspaceSummary.listActiveWorkspaceSummaries).toHaveBeenCalledTimes(0);
    });
  });
});
