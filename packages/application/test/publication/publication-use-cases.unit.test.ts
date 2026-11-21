import { describe, expect, it, vi } from 'vitest';
import {
  PublicationNotFoundError,
  type Publication,
  type PublicationApprovalSnapshot,
  type PublicationApprovalSnapshotId,
  type PublicationId,
  type SocialAccountId,
  type WorkspaceId,
  type UserId,
} from '@affiliate-content-os/domain';
import {
  cancelPublication,
  createPublicationApproval,
  getPublication,
  listPublications,
  processDuePublications,
  reschedulePublication,
  schedulePublication,
  type PublicationDetail,
  type PublicationPersistencePort,
  type SocialPublicationAdapter,
  type WorkspaceAuthorizationPort,
} from '../../src/index.js';
import { WorkspaceAccessDeniedError } from '../../src/errors.js';

describe('Publication Application Use Cases', () => {
  const wsId = '018f0000-0000-7000-8000-000000000001' as WorkspaceId;
  const userId = '018f0000-0000-7000-8000-000000000002' as UserId;
  const snapshotId = '018f0000-0000-7000-8000-000000000003' as PublicationApprovalSnapshotId;
  const pubId = '018f0000-0000-7000-8000-000000000004' as PublicationId;
  const socialAccId = '018f0000-0000-7000-8000-000000000005' as SocialAccountId;
  const contentApprovalId = '018f0000-0000-7000-8000-000000000006';

  const mockAuthPort: WorkspaceAuthorizationPort = {
    findMembership: vi.fn().mockResolvedValue({
      id: '018f0000-0000-7000-8000-000000000007',
      workspaceId: wsId,
      userId,
      role: 'editor',
      status: 'active',
      invitedByUserId: null,
      joinedAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      version: 1,
    }),
  };

  const dummySnapshot: PublicationApprovalSnapshot = {
    id: snapshotId,
    workspaceId: wsId,
    contentApprovalId,
    contentApprovalSnapshotHashHex: 'a'.repeat(64),
    artifactId: '018f0000-0000-7000-8000-000000000008',
    revisionNumber: 1,
    contentHashHex: 'b'.repeat(64),
    platform: 'threads',
    socialAccountId: socialAccId,
    providerAccountId: 'threads_user_1',
    accountVersion: 1,
    capabilityFingerprintHex: 'c'.repeat(64),
    capabilitiesSnapshot: { canPublishText: true, canPublishMedia: false },
    capabilitiesCheckedAt: '2026-11-20T12:00:00.000Z',
    renderedText: 'Test post text',
    previewHashHex: 'd'.repeat(64),
    disclosureState: {},
    platformSettings: {},
    approvedByUserId: userId,
    consentType: 'human_publisher',
    policyVersion: '1.0.0',
    policyHashHex: 'e'.repeat(64),
    snapshotJson: {},
    snapshotHashHex: 'f'.repeat(64),
    createdAt: '2026-11-20T12:00:00.000Z',
  };

  const dummyPub: Publication = {
    id: pubId,
    workspaceId: wsId,
    approvalSnapshotId: snapshotId,
    socialAccountId: socialAccId,
    platform: 'threads',
    status: 'scheduled',
    scheduledAtUtc: '2026-11-25T14:30:00.000Z',
    originalLocalTime: '2026-11-25T09:30:00',
    timezone: 'America/New_York',
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    currentAttemptNumber: 0,
    maxAttempts: 5,
    nextAttemptAt: '2026-11-25T14:30:00.000Z',
    remotePostId: null,
    remotePermalink: null,
    publishedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    gatedReason: null,
    completedAt: null,
    createdByUserId: userId,
    createdAt: '2026-11-20T12:00:00.000Z',
    updatedAt: '2026-11-20T12:00:00.000Z',
    version: 1,
  };

  const dummyDetail: PublicationDetail = {
    publication: dummyPub,
    destination: {
      platform: 'threads',
      displayName: 'Brand Official',
      handle: 'brandofficial',
    },
    approval: {
      renderedText: 'Test post text',
      previewHashHex: 'd'.repeat(64),
      approvedAt: '2026-11-20T12:00:00.000Z',
      approvedByUserId: userId,
    },
    attempts: [],
  };

  const mockPersistence: PublicationPersistencePort = {
    createApprovalSnapshotTransaction: vi.fn().mockResolvedValue(dummySnapshot),
    findApprovalSnapshotById: vi.fn().mockResolvedValue(dummySnapshot),
    createPublicationScheduleTransaction: vi.fn().mockResolvedValue(dummyPub),
    findPublicationById: vi.fn().mockResolvedValue(dummyPub),
    findPublicationDetail: vi.fn().mockResolvedValue(dummyDetail),
    listPublications: vi.fn().mockResolvedValue({ items: [dummyPub], nextCursor: null }),
    reschedulePublicationTransaction: vi.fn().mockResolvedValue({
      ...dummyPub,
      version: 2,
      scheduledAtUtc: '2026-11-26T14:30:00.000Z',
      originalLocalTime: '2026-11-26T09:30:00',
    }),
    cancelPublicationTransaction: vi.fn().mockResolvedValue({
      ...dummyPub,
      version: 2,
      status: 'canceled',
    }),
    claimDuePublications: vi.fn().mockResolvedValue([]),
    prepareAttemptTransaction: vi.fn(),
    settleAttemptTransaction: vi.fn(),
    recoverExpiredLeases: vi.fn().mockResolvedValue({ reclaimedCount: 0, markedUnknownCount: 0 }),
  };

  const dummyIdempotency = {
    rawKey: 'key_123',
    keyHash: new Uint8Array(32),
    requestHash: new Uint8Array(32),
    routeKey: 'test_route',
  };

  describe('createPublicationApproval', () => {
    it('creates approval snapshot when human editor has permissions', async () => {
      const res = await createPublicationApproval(
        {
          workspaceId: wsId,
          actorUserId: userId,
          contentApprovalId,
          socialAccountId: socialAccId,
          videoNumber: 1,
          consent: { consentType: 'human_publisher', policyVersion: '1.0.0' },
          idempotency: dummyIdempotency,
        },
        {
          persistence: mockPersistence,
          workspaceAuthorization: mockAuthPort,
        },
      );
      expect(res.id).toBe(snapshotId);
      expect(mockPersistence.createApprovalSnapshotTransaction).toHaveBeenCalled();
    });

    it('rejects viewer role lacking content.approve / publications.manage', async () => {
      const viewerAuthPort: WorkspaceAuthorizationPort = {
        findMembership: vi.fn().mockResolvedValue({
          id: '018f0000-0000-7000-8000-000000000007',
          workspaceId: wsId,
          userId,
          role: 'viewer',
          status: 'active',
          invitedByUserId: null,
          joinedAt: '2026-10-01T00:00:00.000Z',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          version: 1,
        }),
      };
      await expect(
        createPublicationApproval(
          {
            workspaceId: wsId,
            actorUserId: userId,
            contentApprovalId,
            socialAccountId: socialAccId,
            videoNumber: 1,
            consent: { consentType: 'human_publisher', policyVersion: '1.0.0' },
            idempotency: dummyIdempotency,
          },
          {
            persistence: mockPersistence,
            workspaceAuthorization: viewerAuthPort,
          },
        ),
      ).rejects.toThrow(WorkspaceAccessDeniedError);
    });
  });

  describe('schedulePublication', () => {
    it('schedules publication with valid schedule triple', async () => {
      const res = await schedulePublication(
        {
          workspaceId: wsId,
          actorUserId: userId,
          approvalSnapshotId: snapshotId,
          scheduledAtUtc: '2026-11-25T14:30:00.000Z',
          originalLocalTime: '2026-11-25T09:30:00',
          timezone: 'America/New_York',
          idempotency: dummyIdempotency,
        },
        {
          persistence: mockPersistence,
          workspaceAuthorization: mockAuthPort,
          now: () => new Date('2026-11-21T00:00:00.000Z'),
        },
      );
      expect(res.status).toBe('scheduled');
      expect(mockPersistence.createPublicationScheduleTransaction).toHaveBeenCalled();
    });
  });

  describe('reschedulePublication', () => {
    it('reschedules publication with expected version', async () => {
      const res = await reschedulePublication(
        {
          workspaceId: wsId,
          actorUserId: userId,
          publicationId: pubId,
          expectedVersion: 1,
          scheduledAtUtc: '2026-11-26T14:30:00.000Z',
          originalLocalTime: '2026-11-26T09:30:00',
          timezone: 'America/New_York',
          idempotency: dummyIdempotency,
        },
        {
          persistence: mockPersistence,
          workspaceAuthorization: mockAuthPort,
          now: () => new Date('2026-11-21T00:00:00.000Z'),
        },
      );
      expect(res.version).toBe(2);
      expect(mockPersistence.reschedulePublicationTransaction).toHaveBeenCalled();
    });
  });

  describe('cancelPublication', () => {
    it('cancels scheduled publication', async () => {
      const res = await cancelPublication(
        {
          workspaceId: wsId,
          actorUserId: userId,
          publicationId: pubId,
          expectedVersion: 1,
          idempotency: dummyIdempotency,
        },
        {
          persistence: mockPersistence,
          workspaceAuthorization: mockAuthPort,
        },
      );
      expect(res.status).toBe('canceled');
      expect(mockPersistence.cancelPublicationTransaction).toHaveBeenCalled();
    });
  });

  describe('getPublication and listPublications', () => {
    it('retrieves publication detail', async () => {
      const detail = await getPublication(
        { workspaceId: wsId, actorUserId: userId, publicationId: pubId },
        { persistence: mockPersistence, workspaceAuthorization: mockAuthPort },
      );
      expect(detail.publication.id).toBe(pubId);
      expect(detail.destination.platform).toBe('threads');
    });

    it('lists publications with bounded cursor pagination', async () => {
      const list = await listPublications(
        { workspaceId: wsId, actorUserId: userId, options: { limit: 10 } },
        { persistence: mockPersistence, workspaceAuthorization: mockAuthPort },
      );
      expect(list.items).toHaveLength(1);
    });

    it('throws PublicationNotFoundError when detail not found', async () => {
      const emptyPersistence: PublicationPersistencePort = {
        ...mockPersistence,
        findPublicationDetail: vi.fn().mockResolvedValue(null),
      };
      await expect(
        getPublication(
          { workspaceId: wsId, actorUserId: userId, publicationId: pubId },
          { persistence: emptyPersistence, workspaceAuthorization: mockAuthPort },
        ),
      ).rejects.toThrow(PublicationNotFoundError);
    });
  });

  describe('processDuePublications', () => {
    it('processes claimed publication through adapter and settles result', async () => {
      const claimPersistence: PublicationPersistencePort = {
        ...mockPersistence,
        claimDuePublications: vi
          .fn()
          .mockResolvedValue([{ publication: dummyPub, leaseToken: 'lease-token-123' }]),
        prepareAttemptTransaction: vi.fn().mockResolvedValue({
          kind: 'ready',
          attemptId: '018f0000-0000-7000-8000-000000000099',
          attemptNumber: 1,
          attemptIdempotencyKey: 'pub_attempt_1',
          requestHashHex: 'f'.repeat(64),
          renderedText: 'Post text',
          platformSettings: {},
          socialAccountId: socialAccId,
          providerAccountId: 'threads_user_1',
        }),
        settleAttemptTransaction: vi.fn().mockResolvedValue(undefined),
      };

      const mockAdapter: SocialPublicationAdapter = {
        publishText: vi.fn().mockResolvedValue({
          kind: 'published',
          remotePostId: 'remote_123',
          remotePermalink: 'https://threads.net/p/remote_123',
          publishedAt: '2026-11-25T14:30:05.000Z',
        }),
      };

      const res = await processDuePublications(
        { workerId: 'worker-1' },
        {
          persistence: claimPersistence,
          adapter: mockAdapter,
          enabled: true,
        },
      );

      expect(res.processedCount).toBe(1);
      expect(mockAdapter.publishText).toHaveBeenCalled();
      expect(claimPersistence.settleAttemptTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: expect.objectContaining({ kind: 'published', remotePostId: 'remote_123' }),
        }),
      );
    });

    it('settles as outcome_unknown when adapter throws or times out', async () => {
      const claimPersistence: PublicationPersistencePort = {
        ...mockPersistence,
        claimDuePublications: vi
          .fn()
          .mockResolvedValue([{ publication: dummyPub, leaseToken: 'lease-token-123' }]),
        prepareAttemptTransaction: vi.fn().mockResolvedValue({
          kind: 'ready',
          attemptId: '018f0000-0000-7000-8000-000000000099',
          attemptNumber: 1,
          attemptIdempotencyKey: 'pub_attempt_1',
          requestHashHex: 'f'.repeat(64),
          renderedText: 'Post text',
          platformSettings: {},
          socialAccountId: socialAccId,
          providerAccountId: 'threads_user_1',
        }),
        settleAttemptTransaction: vi.fn().mockResolvedValue(undefined),
      };

      const mockAdapter: SocialPublicationAdapter = {
        publishText: vi.fn().mockRejectedValue(new Error('Network hangup')),
      };

      const res = await processDuePublications(
        { workerId: 'worker-1' },
        {
          persistence: claimPersistence,
          adapter: mockAdapter,
          enabled: true,
        },
      );

      expect(res.processedCount).toBe(1);
      expect(claimPersistence.settleAttemptTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: expect.objectContaining({ kind: 'outcome_unknown' }),
        }),
      );
    });

    it('settles as retry_wait with backoff on transient failure', async () => {
      const claimPersistence: PublicationPersistencePort = {
        ...mockPersistence,
        claimDuePublications: vi
          .fn()
          .mockResolvedValue([{ publication: dummyPub, leaseToken: 'lease-token-123' }]),
        prepareAttemptTransaction: vi.fn().mockResolvedValue({
          kind: 'ready',
          attemptId: '018f0000-0000-7000-8000-000000000099',
          attemptNumber: 1,
          attemptIdempotencyKey: 'pub_attempt_1',
          requestHashHex: 'f'.repeat(64),
          renderedText: 'Post text',
          platformSettings: {},
          socialAccountId: socialAccId,
          providerAccountId: 'threads_user_1',
        }),
        settleAttemptTransaction: vi.fn().mockResolvedValue(undefined),
      };

      const mockAdapter: SocialPublicationAdapter = {
        publishText: vi.fn().mockResolvedValue({
          kind: 'transient_failure',
          errorCode: 'RATE_LIMITED',
          errorMessage: 'Too many requests',
          retryAfterMs: 5000,
        }),
      };

      const res = await processDuePublications(
        { workerId: 'worker-1' },
        {
          persistence: claimPersistence,
          adapter: mockAdapter,
          enabled: true,
        },
      );

      expect(res.processedCount).toBe(1);
      expect(claimPersistence.settleAttemptTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: expect.objectContaining({ kind: 'transient_failure' }),
          nextAttemptAt: expect.any(String),
        }),
      );
    });
  });
});
