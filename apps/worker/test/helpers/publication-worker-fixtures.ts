import { vi } from 'vitest';
import type { AppConfig, SocialConfig } from '@affiliate-content-os/config';
import type {
  Publication,
  PublicationApprovalSnapshotId,
  PublicationAttemptId,
  PublicationId,
  SocialAccountId,
  UserId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type {
  ClaimDuePublicationsParams,
  ClaimedPublication,
  LeaseRecoveryResult,
  PrepareAttemptParams,
  PrepareAttemptResult,
  PublicationPersistencePort,
  RecoverExpiredLeasesParams,
  SettleAttemptParams,
} from '@affiliate-content-os/application';

export const baseWorkerAppConfig: AppConfig = Object.freeze({
  nodeEnv: 'test',
  logLevel: 'info',
  apiHost: '127.0.0.1',
  apiPort: 3001,
});

export const baseWorkerSocialConfig: SocialConfig = Object.freeze({
  enabled: true,
  socialKillSwitchActive: false,
  threadsPublishKillSwitchActive: false,
  socialMaintenanceEnabled: false,
  threadsAppReviewStatus: 'development',
  threadsHttpTimeoutMs: 2000,
  publicationWorkerPollingIntervalMs: 50,
  publicationWorkerLeaseDurationSeconds: 30,
  fakeAdapterEnabled: true,
} as unknown as SocialConfig);

export const mockWorkspaceId = 'ws_pub_worker_test' as WorkspaceId;
export const mockPublicationId = 'pub_worker_test_1' as PublicationId;
export const mockSocialAccountId = 'soc_acc_test_1' as SocialAccountId;
export const mockAttemptId = 'att_worker_test_1' as PublicationAttemptId;

export const samplePublication: Publication = {
  id: mockPublicationId,
  workspaceId: mockWorkspaceId,
  approvalSnapshotId: 'snap_test_1' as PublicationApprovalSnapshotId,
  socialAccountId: mockSocialAccountId,
  platform: 'threads',
  status: 'scheduled',
  scheduledAtUtc: '2026-11-25T14:30:00.000Z',
  originalLocalTime: '2026-11-25T14:30:00',
  timezone: 'UTC',
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
  createdByUserId: 'usr_test_1' as UserId,
  createdAt: '2026-11-23T00:00:00.000Z',
  updatedAt: '2026-11-23T00:00:00.000Z',
  version: 1,
};

export const sampleClaimedPublication: ClaimedPublication = {
  publication: samplePublication,
  leaseToken: 'lease_token_test_123',
};

export const sampleReadyPrepareResult: PrepareAttemptResult = {
  kind: 'ready',
  attemptId: mockAttemptId,
  attemptNumber: 1,
  attemptIdempotencyKey: 'idem_key_worker_test_1',
  requestHashHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  renderedText: 'Test threads publish body',
  platformSettings: { topic: 'deal-alert' },
  socialAccountId: mockSocialAccountId,
  providerAccountId: 'prov_threads_123',
  decryptedAccessToken: 'fake_token_test',
};

export interface InMemoryPublicationPersistenceOptions {
  claimedItems?: ClaimedPublication[] | undefined;
  prepareResult?:
    PrepareAttemptResult | ((params: PrepareAttemptParams) => PrepareAttemptResult) | undefined;
  onPrepareAttempt?: ((params: PrepareAttemptParams) => void) | undefined;
  onSettleAttempt?: ((params: SettleAttemptParams) => Promise<void> | void) | undefined;
  recoveryResult?: LeaseRecoveryResult | undefined;
  onRecoverExpiredLeases?: ((params: RecoverExpiredLeasesParams) => void) | undefined;
  onClaimDuePublications?: ((params: ClaimDuePublicationsParams) => void) | undefined;
}

export interface InMemoryPublicationPersistenceState {
  readonly port: PublicationPersistencePort;
  readonly settledAttempts: SettleAttemptParams[];
  readonly recoveryCalls: RecoverExpiredLeasesParams[];
  readonly claimCalls: ClaimDuePublicationsParams[];
  readonly prepareCalls: PrepareAttemptParams[];
}

export function createInMemoryPublicationPersistencePort(
  options: InMemoryPublicationPersistenceOptions = {},
): InMemoryPublicationPersistenceState {
  const settledAttempts: SettleAttemptParams[] = [];
  const recoveryCalls: RecoverExpiredLeasesParams[] = [];
  const claimCalls: ClaimDuePublicationsParams[] = [];
  const prepareCalls: PrepareAttemptParams[] = [];

  const port: PublicationPersistencePort = {
    claimDuePublications: vi.fn(async (params: ClaimDuePublicationsParams) => {
      claimCalls.push(params);
      options.onClaimDuePublications?.(params);
      return options.claimedItems ?? [];
    }),
    prepareAttemptTransaction: vi.fn(async (params: PrepareAttemptParams) => {
      prepareCalls.push(params);
      options.onPrepareAttempt?.(params);
      if (typeof options.prepareResult === 'function') {
        return options.prepareResult(params);
      }
      return options.prepareResult ?? sampleReadyPrepareResult;
    }),
    settleAttemptTransaction: vi.fn(async (params: SettleAttemptParams) => {
      settledAttempts.push(params);
      if (options.onSettleAttempt) {
        await options.onSettleAttempt(params);
      }
    }),
    recoverExpiredLeases: vi.fn(async (params: RecoverExpiredLeasesParams) => {
      recoveryCalls.push(params);
      options.onRecoverExpiredLeases?.(params);
      return options.recoveryResult ?? { reclaimedCount: 0, markedUnknownCount: 0 };
    }),
    createApprovalSnapshotTransaction: vi.fn(),
    findApprovalSnapshotById: vi.fn(),
    createPublicationScheduleTransaction: vi.fn(),
    findPublicationById: vi.fn(),
    findPublicationDetail: vi.fn(),
    listPublications: vi.fn(),
    reschedulePublicationTransaction: vi.fn(),
    cancelPublicationTransaction: vi.fn(),
  };

  return {
    port,
    settledAttempts,
    recoveryCalls,
    claimCalls,
    prepareCalls,
  };
}
