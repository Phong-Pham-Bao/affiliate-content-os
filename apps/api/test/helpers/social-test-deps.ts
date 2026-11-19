import {
  DefaultIdGenerator,
  SystemClock,
  type SocialAuthAdapter,
  type WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import {
  parseIsoTimestamp,
  parseMembershipId,
  type SocialPlatform,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipSnapshot,
} from '@affiliate-content-os/domain';
import {
  FakeSocialAuthAdapter,
  LocalSocialCredentialProtector,
} from '@affiliate-content-os/infrastructure/social';
import type { SocialConfig } from '@affiliate-content-os/config';
import type { SocialRouteDependencies } from '../../src/social/types.js';
import { createMockAuthDeps } from './auth-test-fakes.js';
import { InMemorySocialPersistence } from './in-memory-social-persistence.js';

export const TEST_WORKSPACE_ID = '0192b012-3456-789a-8bcd-ef0123456702' as WorkspaceId;
export const FOREIGN_WORKSPACE_ID = '0192b012-3456-789a-8bcd-ef0123456799' as WorkspaceId;

export const OWNER_USER_ID = '0192b012-3456-789a-8bcd-ef0123456701' as UserId;
export const EDITOR_USER_ID = '0192b012-3456-789a-8bcd-ef0123456703' as UserId;
export const VIEWER_USER_ID = '0192b012-3456-789a-8bcd-ef0123456704' as UserId;

export interface TestSocialDepsContext {
  readonly deps: SocialRouteDependencies;
  readonly persistence: InMemorySocialPersistence;
  readonly setActiveUser: (userId: UserId) => void;
  readonly clock: SystemClock;
  readonly idGenerator: DefaultIdGenerator;
}

export function createTestSocialDeps(options?: {
  readonly defaultUserId?: UserId;
  readonly socialConfigOverrides?: Partial<SocialConfig>;
}): TestSocialDepsContext {
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

  const persistence = new InMemorySocialPersistence();
  const protector = new LocalSocialCredentialProtector(
    'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE',
    'v1',
  );

  const fakeThreadsAdapter = new FakeSocialAuthAdapter({
    platform: 'threads',
    authBaseUrl: 'http://localhost:3000',
  });
  const fakeTikTokAdapter = new FakeSocialAuthAdapter({
    platform: 'tiktok',
    authBaseUrl: 'http://localhost:3000',
  });

  const authAdapters = new Map<SocialPlatform, SocialAuthAdapter>([
    ['threads', fakeThreadsAdapter],
    ['tiktok', fakeTikTokAdapter],
  ]);

  const socialConfig: SocialConfig = {
    enabled: true,
    fakeAdapterEnabled: true,
    keyProvider: 'local',
    credentialEncryptionKeyBase64Url: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE',
    credentialKeyVersion: 'v1',
    transactionTtlSeconds: 600,
    callbackResultTtlSeconds: 300,
    threadsRealAdapterEnabled: false,
    threadsAppId: null,
    threadsAppSecret: null,
    threadsRedirectUri: null,
    threadsAuthBaseUrl: 'https://threads.net',
    threadsApiBaseUrl: 'https://graph.threads.net',
    threadsApiVersion: 'v1.0',
    threadsAppReviewStatus: 'approved',
    threadsHttpTimeoutMs: 10000,
    socialKillSwitchActive: false,
    threadsConnectionKillSwitchActive: false,
    threadsRefreshKillSwitchActive: false,
    socialMaintenanceEnabled: false,
    ...options?.socialConfigOverrides,
  };

  const clock = new SystemClock();
  const idGenerator = new DefaultIdGenerator();

  const deps: SocialRouteDependencies = {
    auth,
    socialConfig,
    socialPersistence: persistence,
    credentialProtector: protector,
    authAdapters,
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
