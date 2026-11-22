import { vi } from 'vitest';
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
import type { SocialConfig } from '@affiliate-content-os/config';
import type { PublicationPersistencePort } from '@affiliate-content-os/application';
import type { PublicationRouteDependencies } from '../../src/publication/types.js';
import { createMockAuthDeps } from './auth-test-fakes.js';
import {
  dummyPublication,
  dummyPublicationDetail,
  dummySnapshot,
  EDITOR_USER_ID,
  OWNER_USER_ID,
  TEST_SOCIAL_ACCOUNT_ID,
  TEST_WORKSPACE_ID,
  VIEWER_USER_ID,
} from './publication-test-fixtures.js';

export * from './publication-test-fixtures.js';

export function createMockPublicationPersistence(
  overrides?: Partial<PublicationPersistencePort>,
): PublicationPersistencePort {
  return {
    createApprovalSnapshotTransaction: vi.fn().mockResolvedValue(dummySnapshot),
    findApprovalSnapshotById: vi.fn().mockResolvedValue(dummySnapshot),
    createPublicationScheduleTransaction: vi.fn().mockResolvedValue(dummyPublication),
    findPublicationById: vi.fn().mockResolvedValue(dummyPublication),
    findPublicationDetail: vi.fn().mockResolvedValue(dummyPublicationDetail),
    listPublications: vi.fn().mockResolvedValue({ items: [dummyPublication], nextCursor: null }),
    reschedulePublicationTransaction: vi.fn().mockResolvedValue({
      ...dummyPublication,
      version: 2,
      scheduledAtUtc: '2026-11-26T14:30:00.000Z',
      originalLocalTime: '2026-11-26T09:30:00',
    }),
    cancelPublicationTransaction: vi.fn().mockResolvedValue({
      ...dummyPublication,
      version: 2,
      status: 'canceled',
      completedAt: '2026-11-21T10:00:00.000Z',
    }),
    claimDuePublications: vi.fn().mockResolvedValue([]),
    prepareAttemptTransaction: vi.fn().mockResolvedValue({
      attemptId: 'att-1',
      attemptNumber: 1,
      attemptIdempotencyKey: 'key-1',
      requestHashHex: 'a'.repeat(64),
      adapterVersion: 'v1',
      correlationId: 'corr-1',
      renderedText: 'Test',
      socialAccountId: TEST_SOCIAL_ACCOUNT_ID,
      platform: 'threads',
      credentialPayload: null,
    }),
    settleAttemptTransaction: vi.fn().mockResolvedValue(undefined),
    recoverExpiredLeases: vi.fn().mockResolvedValue({ recoveredCount: 0, unknownCount: 0 }),
    ...overrides,
  };
}

export function createTestPublicationDeps(options?: {
  readonly defaultUserId?: UserId;
  readonly mockPersistence?: Partial<PublicationPersistencePort>;
  readonly socialConfigOverrides?: Partial<SocialConfig>;
}): {
  readonly deps: PublicationRouteDependencies;
  readonly persistence: PublicationPersistencePort;
  readonly setActiveUser: (userId: UserId) => void;
  readonly clock: SystemClock;
  readonly idGenerator: DefaultIdGenerator;
} {
  let activeUserId: UserId = options?.defaultUserId ?? EDITOR_USER_ID;

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

  const persistence = createMockPublicationPersistence(options?.mockPersistence);
  const clock = new SystemClock();
  const idGenerator = new DefaultIdGenerator();

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
    metaGraphBaseUrl: 'https://graph.facebook.com',
    metaGraphVersion: 'v21.0',
    threadsAppAccessToken: null,
    threadsAppReviewStatus: 'approved',
    threadsHttpTimeoutMs: 10000,
    socialKillSwitchActive: false,
    threadsConnectionKillSwitchActive: false,
    threadsRefreshKillSwitchActive: false,
    threadsPublishKillSwitchActive: false,
    socialMaintenanceEnabled: false,
    publicationWorkerPollingIntervalMs: 2000,
    publicationWorkerLeaseDurationSeconds: 30,
    minScheduleLeadTimeSeconds: 60,
    maxScheduleHorizonDays: 90,
    ...options?.socialConfigOverrides,
  };

  const deps: PublicationRouteDependencies = {
    auth,
    publicationPersistence: persistence,
    workspaceAuthorization,
    clock,
    socialConfig,
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
