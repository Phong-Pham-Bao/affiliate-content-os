import {
  DefaultIdGenerator,
  SystemClock,
  type WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import {
  parseIsoTimestamp,
  parseMembershipId,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
} from '@affiliate-content-os/domain';
import type { CatalogRouteDependencies } from '../../src/catalog/types.js';
import { createMockAuthDeps } from './auth-test-fakes.js';
import { InMemoryCatalogPersistence } from './in-memory-catalog-persistence.js';

export const TEST_WORKSPACE_ID = '0192b012-3456-789a-8bcd-ef0123456702' as WorkspaceId;
export const FOREIGN_WORKSPACE_ID = '0192b012-3456-789a-8bcd-ef0123456799' as WorkspaceId;

export const OWNER_USER_ID = '0192b012-3456-789a-8bcd-ef0123456701' as UserId;
export const EDITOR_USER_ID = '0192b012-3456-789a-8bcd-ef0123456703' as UserId;
export const VIEWER_USER_ID = '0192b012-3456-789a-8bcd-ef0123456704' as UserId;

export interface TestCatalogDepsContext {
  readonly deps: CatalogRouteDependencies;
  readonly persistence: InMemoryCatalogPersistence;
  readonly setActiveUser: (userId: UserId) => void;
  readonly clock: SystemClock;
  readonly idGenerator: DefaultIdGenerator;
}

export function createTestCatalogDeps(options?: {
  readonly defaultUserId?: UserId;
}): TestCatalogDepsContext {
  let activeUserId: UserId = options?.defaultUserId ?? OWNER_USER_ID;

  const auth = createMockAuthDeps();
  auth.sessionStore.findCandidateSessions = async () => [
    {
      id: '0192b012-3456-789a-8bcd-ef0123456720',
      userId: activeUserId,
      currentTokenHash: new Uint8Array(32).fill(7),
      previousTokenHash: null,
      previousTokenValidUntil: null,
      createdAt: '2026-11-02T12:00:00.000Z',
      lastSeenAt: '2026-11-02T12:00:00.000Z',
      idleExpiresAt: '2026-11-02T12:30:00.000Z',
      absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
      rotatedAt: '2026-11-02T12:00:00.000Z',
      revokedAt: null,
      revocationReason: null,
      version: 1,
    },
  ];

  const buildUser = (id: UserId) =>
    Object.freeze({
      id,
      identityProvider: 'https://auth.example.com',
      identitySubject: `sub-${id}`,
      email: `${id}@example.com`,
      displayName: `User ${id}`,
      status: 'active' as const,
      createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
      version: 1,
    });

  auth.sessionStore.findUserById = async () => buildUser(activeUserId);
  auth.userDirectory.findUserById = async () => buildUser(activeUserId);

  const persistence = new InMemoryCatalogPersistence();
  const clock = new SystemClock();
  const idGenerator = new DefaultIdGenerator();

  const workspaceAuthorization: WorkspaceAuthorizationPort = {
    async findMembership(params: {
      readonly workspaceId: WorkspaceId;
      readonly userId: UserId;
    }): Promise<WorkspaceMembershipSnapshot | null> {
      if (params.workspaceId !== TEST_WORKSPACE_ID) {
        return null;
      }
      let role: 'owner' | 'editor' | 'viewer' = 'viewer';
      if (params.userId === OWNER_USER_ID) role = 'owner';
      else if (params.userId === EDITOR_USER_ID) role = 'editor';
      else if (params.userId === VIEWER_USER_ID) role = 'viewer';

      return {
        id: parseMembershipId('0192b012-3456-789a-8bcd-ef0123456710'),
        workspaceId: params.workspaceId,
        userId: params.userId,
        role,
        status: 'active',
        invitedByUserId: null,
        joinedAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
        createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
        version: 1,
      };
    },
  };

  const deps: CatalogRouteDependencies = {
    auth,
    catalogPersistence: persistence,
    workspaceAuthorization,
    clock,
    idGenerator,
  };

  return {
    deps,
    persistence,
    setActiveUser: (userId: UserId) => {
      activeUserId = userId;
    },
    clock,
    idGenerator,
  };
}
