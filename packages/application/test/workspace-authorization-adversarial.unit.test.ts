import { spawn } from 'node:child_process';
import util from 'node:util';
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
  WorkspaceAccessDeniedError,
  WorkspaceAuthorizationInputError,
  WorkspaceAuthorizationPersistenceError,
} from '../src/errors.js';
import type { WorkspaceAuthorizationPort } from '../src/ports.js';

describe('Workspace Authorization Adversarial & Non-Disclosure Suite', () => {
  const validWorkspaceId = '0192b012-3456-789a-8bcd-ef0123456001';
  const validUserId = '0192b012-3456-789a-8bcd-ef0123456002';
  const validMembershipId = '0192b012-3456-789a-8bcd-ef0123456003';
  const nowIso = parseIsoTimestamp('2026-11-05T12:00:00.000Z');
  const SENTINEL = 'CONFIDENTIAL_AUTH_SENTINEL_xyz123';

  function createValidMembership(): WorkspaceMembershipSnapshot {
    return Object.freeze({
      id: parseMembershipId(validMembershipId),
      workspaceId: parseWorkspaceId(validWorkspaceId),
      userId: parseUserId(validUserId),
      role: 'owner',
      status: 'active',
      invitedByUserId: null,
      joinedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    });
  }

  describe('1. Hostile Proxies and Trap Free Rejection', () => {
    it('executes zero traps when hostile proxy is supplied as authorization input', async () => {
      let trapCalls = 0;
      const target = {
        workspaceId: validWorkspaceId,
        userId: validUserId,
        capability: 'workspace.read',
      };

      const hostileInputProxy = new Proxy(target, {
        get() {
          trapCalls++;
          throw new Error(`HOSTILE_GET_TRAP_${SENTINEL}`);
        },
        getPrototypeOf() {
          trapCalls++;
          throw new Error(`HOSTILE_PROTO_TRAP_${SENTINEL}`);
        },
        has() {
          trapCalls++;
          throw new Error(`HOSTILE_HAS_TRAP_${SENTINEL}`);
        },
        ownKeys() {
          trapCalls++;
          throw new Error(`HOSTILE_OWNKEYS_TRAP_${SENTINEL}`);
        },
      });

      const port: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(),
      };

      await expect(
        authorizeWorkspaceAction(hostileInputProxy as unknown as AuthorizeWorkspaceActionInput, {
          authorization: port,
        }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      expect(trapCalls).toBe(0);
      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('safely rejects revoked proxy input without unhandled exception', async () => {
      const { proxy, revoke } = Proxy.revocable(
        {
          workspaceId: validWorkspaceId,
          userId: validUserId,
          capability: 'workspace.read',
        },
        {},
      );
      revoke();

      const port: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(),
      };

      await expect(
        authorizeWorkspaceAction(proxy as unknown as AuthorizeWorkspaceActionInput, {
          authorization: port,
        }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('executes zero traps when hostile proxy is returned by persistence port', async () => {
      let trapCalls = 0;
      const validMembership = createValidMembership();

      const hostileSnapshotProxy = new Proxy(validMembership, {
        get(_t, prop) {
          if (prop === 'then') return undefined;
          trapCalls++;
          throw new Error(`HOSTILE_SNAPSHOT_GET_${SENTINEL}`);
        },
        getPrototypeOf() {
          trapCalls++;
          throw new Error(`HOSTILE_SNAPSHOT_PROTO_${SENTINEL}`);
        },
        has() {
          trapCalls++;
          throw new Error(`HOSTILE_SNAPSHOT_HAS_${SENTINEL}`);
        },
        ownKeys() {
          trapCalls++;
          throw new Error(`HOSTILE_SNAPSHOT_OWNKEYS_${SENTINEL}`);
        },
      });

      const port: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(async () => hostileSnapshotProxy),
      };

      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: port },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);

      expect(trapCalls).toBe(0);
    });

    it('safely rejects revoked proxy snapshot returned by persistence port', async () => {
      const { proxy, revoke } = Proxy.revocable(createValidMembership(), {});
      revoke();

      const port: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(async () => proxy),
      };

      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: port },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);
    });
  });

  describe('2. Hostile Getters and Descriptor Boundaries', () => {
    it('executes zero getter calls on input accessors and leaks no sentinels', async () => {
      let getterCalls = 0;
      const hostileInput = {
        userId: validUserId,
        capability: 'workspace.read' as const,
      };
      Object.defineProperty(hostileInput, 'workspaceId', {
        get() {
          getterCalls++;
          throw new Error(`HOSTILE_INPUT_GETTER_${SENTINEL}`);
        },
        enumerable: true,
      });

      const port: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(),
      };

      await expect(
        authorizeWorkspaceAction(hostileInput as unknown as AuthorizeWorkspaceActionInput, {
          authorization: port,
        }),
      ).rejects.toThrow(WorkspaceAuthorizationInputError);

      expect(getterCalls).toBe(0);
      expect(port.findMembership).toHaveBeenCalledTimes(0);
    });

    it('executes zero getter calls on snapshot accessors and leaks no sentinels', async () => {
      let getterCalls = 0;
      const snapshot = { ...createValidMembership() };
      Object.defineProperty(snapshot, 'role', {
        get() {
          getterCalls++;
          throw new Error(`HOSTILE_SNAPSHOT_GETTER_${SENTINEL}`);
        },
        enumerable: true,
      });

      const port: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(async () => snapshot as unknown as WorkspaceMembershipSnapshot),
      };

      await expect(
        authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: port },
        ),
      ).rejects.toThrow(WorkspaceAuthorizationPersistenceError);

      expect(getterCalls).toBe(0);
    });
  });

  describe('3. Public Error Sentinel Non-Disclosure Surfaces', () => {
    it('ignores extra constructor arguments and excludes sentinels across in-process surfaces', () => {
      type HostileCtor<T> = new (...args: unknown[]) => T;
      const errorFactories: Array<() => Error> = [
        () =>
          new (
            WorkspaceAuthorizationInputError as unknown as HostileCtor<WorkspaceAuthorizationInputError>
          )(SENTINEL, 'EXTRA_ARG_2'),
        () =>
          new (WorkspaceAccessDeniedError as unknown as HostileCtor<WorkspaceAccessDeniedError>)(
            SENTINEL,
            'EXTRA_ARG_2',
          ),
        () =>
          new (
            WorkspaceAuthorizationPersistenceError as unknown as HostileCtor<WorkspaceAuthorizationPersistenceError>
          )(SENTINEL, 'EXTRA_ARG_2'),
      ];

      for (const make of errorFactories) {
        const err = make();
        expect(err.message).not.toContain(SENTINEL);
        expect(String(err)).not.toContain(SENTINEL);
        expect(err.stack).not.toContain(SENTINEL);
        expect(err.cause).toBeUndefined();

        const keys = Object.keys(err);
        expect(keys).not.toContain(SENTINEL);
        for (const k of keys) {
          expect(String((err as unknown as Record<string, unknown>)[k])).not.toContain(SENTINEL);
        }

        const ownKeys = Reflect.ownKeys(err);
        expect(ownKeys.map(String)).not.toContain(SENTINEL);
        for (const k of ownKeys) {
          const val = (err as unknown as Record<string | symbol, unknown>)[k];
          if (typeof val === 'string') {
            expect(val).not.toContain(SENTINEL);
          }
        }

        expect(JSON.stringify(err)).not.toContain(SENTINEL);
        expect(util.inspect(err, { customInspect: true, depth: null })).not.toContain(SENTINEL);
        expect(util.inspect(err, { customInspect: false, depth: null })).not.toContain(SENTINEL);

        const logs: string[] = [];
        const fakeLogger = {
          info: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
          error: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        };
        fakeLogger.info('info', err);
        fakeLogger.error('error', err);
        for (const log of logs) {
          expect(log).not.toContain(SENTINEL);
        }
      }
    });

    it('proves port credential/SQL rejections never leak through caught error surfaces', async () => {
      const sensitiveLeak = `SECRET_DB_PASSWORD_9999; SELECT * FROM users WHERE token = '${SENTINEL}'`;
      const port: WorkspaceAuthorizationPort = {
        findMembership: vi.fn(async () => {
          const err = new Error(sensitiveLeak);
          (err as unknown as Record<string, unknown>).credential = sensitiveLeak;
          throw err;
        }),
      };

      try {
        await authorizeWorkspaceAction(
          { workspaceId: validWorkspaceId, userId: validUserId, capability: 'workspace.read' },
          { authorization: port },
        );
        expect.unreachable('Should fail');
      } catch (caught: unknown) {
        expect(caught).toBeInstanceOf(WorkspaceAuthorizationPersistenceError);
        const pErr = caught as WorkspaceAuthorizationPersistenceError;
        expect(pErr.cause).toBeUndefined();
        expect(pErr.message).not.toContain('SECRET_DB_PASSWORD');
        expect(pErr.message).not.toContain(SENTINEL);
        expect(String(pErr)).not.toContain(SENTINEL);
        expect(pErr.stack).not.toContain(SENTINEL);
        expect(JSON.stringify(pErr)).not.toContain(SENTINEL);
        expect(util.inspect(pErr, { depth: null })).not.toContain(SENTINEL);
      }
    });

    it('proves extra sentinel arguments never leak to child process stdout or stderr', async () => {
      const childScript = `
        import {
          WorkspaceAuthorizationInputError,
          WorkspaceAccessDeniedError,
          WorkspaceAuthorizationPersistenceError,
        } from './packages/application/src/errors.ts';
        import util from 'node:util';

        const s = '${SENTINEL}';
        const instances = [
          new WorkspaceAuthorizationInputError(s, 'EXTRA_ARG'),
          new WorkspaceAccessDeniedError(s, 'EXTRA_ARG'),
          new WorkspaceAuthorizationPersistenceError(s, 'EXTRA_ARG'),
        ];

        for (const inst of instances) {
          console.log(String(inst));
          console.log(JSON.stringify(inst));
          console.log(util.inspect(inst, { depth: null }));
        }
      `;

      const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
        (resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--import', 'tsx', '--input-type=module', '-e', childScript],
            {
              cwd: process.cwd(),
              env: { ...process.env, NODE_ENV: 'test' },
            },
          );

          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (d) => (stdout += String(d)));
          child.stderr?.on('data', (d) => (stderr += String(d)));
          child.on('error', reject);
          child.on('close', (code) => resolve({ stdout, stderr, code }));
        },
      );

      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain(SENTINEL);
      expect(result.stderr).not.toContain(SENTINEL);
    });
  });
});
