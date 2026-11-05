import { describe, expect, it, vi } from 'vitest';
import {
  parseIsoTimestamp,
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type WorkspaceMembershipSnapshot,
} from '@affiliate-content-os/domain';
import {
  authorizeWorkspaceAction,
  type AuthorizeWorkspaceActionInput,
} from '../src/authorize-workspace-action.js';
import {
  ApplicationError,
  WorkspaceAccessDeniedError,
  WorkspaceAuthorizationInputError,
  WorkspaceAuthorizationPersistenceError,
} from '../src/errors.js';
import type { WorkspaceAuthorizationPort } from '../src/ports.js';

describe('authorizeWorkspaceAction use case unit tests', () => {
  const validWorkspaceId = '0192b012-3456-789a-8bcd-ef0123456001';
  const validUserId = '0192b012-3456-789a-8bcd-ef0123456002';
  const validMembershipId = '0192b012-3456-789a-8bcd-ef0123456003';
  const nowIso = parseIsoTimestamp('2026-11-05T12:00:00.000Z');

  function createValidMembership(
    overrides?: Partial<WorkspaceMembershipSnapshot>,
  ): WorkspaceMembershipSnapshot {
    return Object.freeze({
      id: parseMembershipId(validMembershipId),
      workspaceId: parseWorkspaceId(validWorkspaceId),
      userId: parseUserId(validUserId),
      role: 'editor',
      status: 'active',
      invitedByUserId: null,
      joinedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
      ...overrides,
    });
  }

  function createMockAuthorizationPort(
    membership: WorkspaceMembershipSnapshot | null = createValidMembership(),
  ): WorkspaceAuthorizationPort {
    return {
      findMembership: vi.fn(async () => membership),
    };
  }

  describe('1. Successful Authorization', () => {
    it('authorizes valid active editor capability and returns fresh frozen context', async () => {
      const port = createMockAuthorizationPort(createValidMembership({ role: 'editor' }));
      const input: AuthorizeWorkspaceActionInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'content.manage',
      };

      const result = await authorizeWorkspaceAction(input, { authorization: port });

      expect(port.findMembership).toHaveBeenCalledTimes(1);
      expect(port.findMembership).toHaveBeenCalledWith({
        workspaceId: validWorkspaceId,
        userId: validUserId,
      });

      expect(Object.isFrozen(result)).toBe(true);
      expect(Reflect.ownKeys(result)).toEqual([
        'workspaceId',
        'userId',
        'membershipId',
        'role',
        'capability',
      ]);
      expect(result.workspaceId).toBe(validWorkspaceId);
      expect(result.userId).toBe(validUserId);
      expect(result.membershipId).toBe(validMembershipId);
      expect(result.role).toBe('editor');
      expect(result.capability).toBe('content.manage');

      // Verify no persistence metadata is leaked on context
      expect((result as unknown as Record<string, unknown>).status).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).createdAt).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).updatedAt).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).version).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).joinedAt).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).invitedByUserId).toBeUndefined();
    });

    it('authorizes owner for owner-only capability', async () => {
      const port = createMockAuthorizationPort(createValidMembership({ role: 'owner' }));
      const input: AuthorizeWorkspaceActionInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.delete_export',
      };

      const result = await authorizeWorkspaceAction(input, { authorization: port });

      expect(result.role).toBe('owner');
      expect(result.capability).toBe('workspace.delete_export');
    });

    it('authorizes viewer for viewer-allowed capability', async () => {
      const port = createMockAuthorizationPort(createValidMembership({ role: 'viewer' }));
      const input: AuthorizeWorkspaceActionInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'audit.read',
      };

      const result = await authorizeWorkspaceAction(input, { authorization: port });

      expect(result.role).toBe('viewer');
      expect(result.capability).toBe('audit.read');
    });

    it('accepts frozen caller DTO and null-prototype input object', async () => {
      const port = createMockAuthorizationPort();

      // Frozen DTO
      const frozenInput = Object.freeze({
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'content.read' as const,
      });
      const res1 = await authorizeWorkspaceAction(frozenInput, { authorization: port });
      expect(res1.capability).toBe('content.read');

      // Null-prototype DTO
      const nullProtoInput = Object.assign(Object.create(null), {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'content.read' as const,
      });
      const res2 = await authorizeWorkspaceAction(nullProtoInput, { authorization: port });
      expect(res2.capability).toBe('content.read');
    });
  });

  describe('2. Authorization Denial (WorkspaceAccessDeniedError)', () => {
    it('denies access when port returns null (non-existent membership)', async () => {
      const port = createMockAuthorizationPort(null);
      const input: AuthorizeWorkspaceActionInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.read',
      };

      await expect(authorizeWorkspaceAction(input, { authorization: port })).rejects.toThrow(
        WorkspaceAccessDeniedError,
      );

      try {
        await authorizeWorkspaceAction(input, { authorization: port });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceAccessDeniedError);
        expect(err).toBeInstanceOf(ApplicationError);
        const denied = err as WorkspaceAccessDeniedError;
        expect(denied.code).toBe('WORKSPACE_ACCESS_DENIED');
        expect(denied.message).toBe('Workspace access denied');
        expect(denied.cause).toBeUndefined();
      }
    });

    it('denies access when membership is suspended', async () => {
      const port = createMockAuthorizationPort(createValidMembership({ status: 'suspended' }));
      const input: AuthorizeWorkspaceActionInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.read',
      };

      await expect(authorizeWorkspaceAction(input, { authorization: port })).rejects.toThrow(
        WorkspaceAccessDeniedError,
      );
    });

    it('denies access when membership is removed', async () => {
      const port = createMockAuthorizationPort(createValidMembership({ status: 'removed' }));
      const input: AuthorizeWorkspaceActionInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.read',
      };

      await expect(authorizeWorkspaceAction(input, { authorization: port })).rejects.toThrow(
        WorkspaceAccessDeniedError,
      );
    });

    it('denies access when returned workspaceId does not match input', async () => {
      const otherWsId = parseWorkspaceId('0192b012-3456-789a-8bcd-ef0123456999');
      const port = createMockAuthorizationPort(createValidMembership({ workspaceId: otherWsId }));
      const input: AuthorizeWorkspaceActionInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.read',
      };

      await expect(authorizeWorkspaceAction(input, { authorization: port })).rejects.toThrow(
        WorkspaceAccessDeniedError,
      );
    });

    it('denies access when returned userId does not match input', async () => {
      const otherUserId = parseUserId('0192b012-3456-789a-8bcd-ef0123456999');
      const port = createMockAuthorizationPort(createValidMembership({ userId: otherUserId }));
      const input: AuthorizeWorkspaceActionInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.read',
      };

      await expect(authorizeWorkspaceAction(input, { authorization: port })).rejects.toThrow(
        WorkspaceAccessDeniedError,
      );
    });

    it('denies access when role is insufficient for capability', async () => {
      // Viewer trying to manage workspace
      const viewerPort = createMockAuthorizationPort(createValidMembership({ role: 'viewer' }));
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.manage' },
          { authorization: viewerPort },
        ),
      ).rejects.toThrow(WorkspaceAccessDeniedError);

      // Editor trying to delete workspace
      const editorPort = createMockAuthorizationPort(createValidMembership({ role: 'editor' }));
      await expect(
        authorizeWorkspaceAction(
          {
            workspaceId: validWorkspaceId,
            userId: validUserId,
            capability: 'workspace.delete_export',
          },
          { authorization: editorPort },
        ),
      ).rejects.toThrow(WorkspaceAccessDeniedError);
    });
  });

  describe('3. Malformed Input Validation (WorkspaceAuthorizationInputError)', () => {
    it('rejects non-object inputs with zero port calls', async () => {
      const port = createMockAuthorizationPort();
      const nonObjects = [null, undefined, 'string', 123, true, Symbol('test'), () => {}];

      for (const val of nonObjects) {
        await expect(
          authorizeWorkspaceAction(val as unknown as AuthorizeWorkspaceActionInput, {
            authorization: port,
          }),
        ).rejects.toThrow(WorkspaceAuthorizationInputError);
      }
      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('rejects arrays and class instances with zero port calls', async () => {
      const port = createMockAuthorizationPort();

      await expect(
        authorizeWorkspaceAction([] as unknown as AuthorizeWorkspaceActionInput, {
          authorization: port,
        }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      class CustomInput {
        workspaceId = validWorkspaceId;
        userId = validUserId;
        capability = 'workspace.read' as const;
      }
      await expect(
        authorizeWorkspaceAction(new CustomInput(), { authorization: port }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('rejects missing keys with zero port calls', async () => {
      const port = createMockAuthorizationPort();

      const missingCases = [
        { workspaceId: validWorkspaceId, userId: validUserId },
        { workspaceId: validWorkspaceId, capability: 'workspace.read' },
        { userId: validUserId, capability: 'workspace.read' },
        {},
      ];

      for (const val of missingCases) {
        await expect(
          authorizeWorkspaceAction(val as unknown as AuthorizeWorkspaceActionInput, {
            authorization: port,
          }),
        ).rejects.toThrow(WorkspaceAuthorizationInputError);
      }
      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('rejects extra keys or symbol keys with zero port calls', async () => {
      const port = createMockAuthorizationPort();

      const extraKeyInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.read' as const,
        extra: true,
      };
      await expect(
        authorizeWorkspaceAction(extraKeyInput as unknown as AuthorizeWorkspaceActionInput, {
          authorization: port,
        }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      const symbolKeyInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.read' as const,
        [Symbol('leak')]: 'sentinel',
      };
      await expect(
        authorizeWorkspaceAction(symbolKeyInput as unknown as AuthorizeWorkspaceActionInput, {
          authorization: port,
        }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('rejects accessor-backed or non-enumerable properties with zero port calls', async () => {
      const port = createMockAuthorizationPort();

      const accessorInput = {
        get workspaceId() {
          return validWorkspaceId;
        },
        userId: validUserId,
        capability: 'workspace.read' as const,
      };
      await expect(
        authorizeWorkspaceAction(accessorInput as unknown as AuthorizeWorkspaceActionInput, {
          authorization: port,
        }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      const nonEnumInput = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
      };
      Object.defineProperty(nonEnumInput, 'capability', {
        value: 'workspace.read',
        enumerable: false,
        configurable: true,
        writable: true,
      });
      await expect(
        authorizeWorkspaceAction(nonEnumInput as unknown as AuthorizeWorkspaceActionInput, {
          authorization: port,
        }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('rejects invalid, uppercase, or noncanonical UUIDs with zero port calls', async () => {
      const port = createMockAuthorizationPort();

      const uppercaseWs = validWorkspaceId.toUpperCase();
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: uppercaseWs, userId: validUserId, capability: 'workspace.read' },
          { authorization: port },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      const invalidUser = 'not-a-uuid';
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: invalidUser, capability: 'workspace.read' },
          { authorization: port },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('rejects unknown capabilities with zero port calls', async () => {
      const port = createMockAuthorizationPort();

      const invalidCaps = ['*', 'workspace.*', 'admin', '', 'unknown'];
      for (const cap of invalidCaps) {
        await expect(
          authorizeWorkspaceAction(
            {
              workspaceId: validWorkspaceId,
              userId: validUserId,
              capability: cap as unknown as AuthorizeWorkspaceActionInput['capability'],
            },
            { authorization: port },
          ),
        ).rejects.toThrow(WorkspaceAuthorizationInputError);
      }

      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });
  });

  describe('4. Persistence Error Handling (WorkspaceAuthorizationPersistenceError)', () => {
    it('maps port rejection into fresh WorkspaceAuthorizationPersistenceError without cause', async () => {
      const port: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(async () => {
          throw new Error('RAW_DB_CONNECTION_FAILURE: host=127.0.0.1');
        }),
      };

      try {
        await authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: port },
        );
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceAuthorizationPersistenceError);
        expect(err).toBeInstanceOf(ApplicationError);
        const pErr = err as WorkspaceAuthorizationPersistenceError;
        expect(pErr.code).toBe('WORKSPACE_AUTHORIZATION_PERSISTENCE_INVALID');
        expect(pErr.message).toBe('Workspace authorization persistence error');
        expect(pErr.operation).toBe('membership_lookup');
        expect(pErr.cause).toBeUndefined();
        expect(String(pErr)).not.toContain('RAW_DB_CONNECTION_FAILURE');
      }
    });

    it('rejects malformed runtime persistence values (non-object, array, non-plain proto)', async () => {
      const malformedResults = [
        'not-an-object',
        123,
        true,
        undefined,
        [],
        Object.create({ someProtoProp: 1 }),
      ];

      for (const val of malformedResults) {
        const port: WorkspaceAuthorizationPort = {
          findMembership: vi.fn(async () => val as unknown as WorkspaceMembershipSnapshot),
        };

        await expect(
          authorizeWorkspaceAction(
            { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
            { authorization: port },
          ),
        ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);
      }
    });

    it('rejects snapshot with missing or extra keys', async () => {
      const base = createValidMembership();

      // Missing version
      const { version: _, ...missingVersion } = base;
      const port1: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(async () => missingVersion as unknown as WorkspaceMembershipSnapshot),
      };
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: port1 },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);

      // Extra property
      const extraProp = { ...base, extraProperty: 'malicious' };
      const port2: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(async () => extraProp as unknown as WorkspaceMembershipSnapshot),
      };
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: port2 },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);
    });

    it('rejects snapshot with invalid role, status, or version', async () => {
      const base = createValidMembership();

      // Unknown role
      const portRole: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(
          async () => ({ ...base, role: 'superadmin' }) as unknown as WorkspaceMembershipSnapshot,
        ),
      };
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: portRole },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);

      // Unknown status
      const portStatus: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(
          async () => ({ ...base, status: 'unknown' }) as unknown as WorkspaceMembershipSnapshot,
        ),
      };
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: portStatus },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);

      // Version 0 or float
      const portVersion: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(
          async () => ({ ...base, version: 0 }) as unknown as WorkspaceMembershipSnapshot,
        ),
      };
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: portVersion },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);
    });

    it('rejects snapshot with timestamp ordering violations', async () => {
      const base = createValidMembership();

      // createdAt > updatedAt
      const portOrder1: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(
          async () =>
            ({
              ...base,
              createdAt: '2026-11-05T12:00:00.000Z',
              updatedAt: '2026-11-05T11:00:00.000Z',
            }) as unknown as WorkspaceMembershipSnapshot,
        ),
      };
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: portOrder1 },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);

      // joinedAt < createdAt
      const portOrder2: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(
          async () =>
            ({
              ...base,
              createdAt: '2026-11-05T12:00:00.000Z',
              joinedAt: '2026-11-05T11:00:00.000Z',
              updatedAt: '2026-11-05T12:00:00.000Z',
            }) as unknown as WorkspaceMembershipSnapshot,
        ),
      };
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: portOrder2 },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);

      // joinedAt > updatedAt
      const portOrder3: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(
          async () =>
            ({
              ...base,
              createdAt: '2026-11-05T12:00:00.000Z',
              joinedAt: '2026-11-05T13:00:00.000Z',
              updatedAt: '2026-11-05T12:00:00.000Z',
            }) as unknown as WorkspaceMembershipSnapshot,
        ),
      };
      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: portOrder3 },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);
    });
  });
});
