import type { PublicationDetail } from '@affiliate-content-os/application';
import {
  type Publication,
  type PublicationApprovalSnapshot,
  type PublicationApprovalSnapshotId,
  type PublicationId,
  type SocialAccountId,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';

export const TEST_WORKSPACE_ID = '0192b012-3456-789a-8bcd-ef0123456702' as WorkspaceId;
export const FOREIGN_WORKSPACE_ID = '0192b012-3456-789a-8bcd-ef0123456799' as WorkspaceId;

export const OWNER_USER_ID = '0192b012-3456-789a-8bcd-ef0123456701' as UserId;
export const EDITOR_USER_ID = '0192b012-3456-789a-8bcd-ef0123456703' as UserId;
export const VIEWER_USER_ID = '0192b012-3456-789a-8bcd-ef0123456704' as UserId;

export const TEST_APPROVAL_SNAPSHOT_ID =
  '0192b012-3456-789a-8bcd-ef0123456711' as PublicationApprovalSnapshotId;
export const TEST_CONTENT_APPROVAL_ID = '0192b012-3456-789a-8bcd-ef0123456712';
export const TEST_PUBLICATION_ID = '0192b012-3456-789a-8bcd-ef0123456713' as PublicationId;
export const TEST_SOCIAL_ACCOUNT_ID = '0192b012-3456-789a-8bcd-ef0123456714' as SocialAccountId;
export const TEST_ARTIFACT_ID = '0192b012-3456-789a-8bcd-ef0123456715';

export const VALID_SESSION_COOKIE = 'A'.repeat(43);
export const VALID_ORIGIN = 'http://127.0.0.1:3000';

export const dummySnapshot: PublicationApprovalSnapshot = Object.freeze({
  id: TEST_APPROVAL_SNAPSHOT_ID,
  workspaceId: TEST_WORKSPACE_ID,
  contentApprovalId: TEST_CONTENT_APPROVAL_ID,
  contentApprovalSnapshotHashHex: 'a'.repeat(64),
  artifactId: TEST_ARTIFACT_ID,
  revisionNumber: 1,
  contentHashHex: 'b'.repeat(64),
  platform: 'threads',
  socialAccountId: TEST_SOCIAL_ACCOUNT_ID,
  providerAccountId: 'threads_user_1',
  accountVersion: 1,
  capabilityFingerprintHex: 'c'.repeat(64),
  capabilitiesSnapshot: Object.freeze({ canPublishText: true }),
  capabilitiesCheckedAt: '2026-11-20T12:00:00.000Z',
  renderedText: 'Official release of ergonomic setup',
  previewHashHex: 'd'.repeat(64),
  disclosureState: Object.freeze({ affiliateDisclosureAdded: true }),
  platformSettings: Object.freeze({ replyControl: 'everyone' }),
  approvedByUserId: EDITOR_USER_ID,
  consentType: 'human_publisher',
  policyVersion: '1.0.0',
  policyHashHex: 'e'.repeat(64),
  snapshotJson: Object.freeze({ note: 'human verified' }),
  snapshotHashHex: 'f'.repeat(64),
  createdAt: '2026-11-20T12:00:00.000Z',
});

export const dummyPublication: Publication = Object.freeze({
  id: TEST_PUBLICATION_ID,
  workspaceId: TEST_WORKSPACE_ID,
  approvalSnapshotId: TEST_APPROVAL_SNAPSHOT_ID,
  socialAccountId: TEST_SOCIAL_ACCOUNT_ID,
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
  createdByUserId: EDITOR_USER_ID,
  createdAt: '2026-11-20T12:00:00.000Z',
  updatedAt: '2026-11-20T12:00:00.000Z',
  version: 1,
});

export const dummyPublicationDetail: PublicationDetail = Object.freeze({
  publication: dummyPublication,
  destination: Object.freeze({
    platform: 'threads',
    displayName: 'Brand Official',
    handle: 'brandofficial',
  }),
  approval: Object.freeze({
    renderedText: 'Official release of ergonomic setup',
    previewHashHex: 'd'.repeat(64),
    approvedAt: '2026-11-20T12:00:00.000Z',
    approvedByUserId: EDITOR_USER_ID,
  }),
  attempts: Object.freeze([
    {
      attemptNumber: 1,
      status: 'failed',
      phase: 'provider_attempt_started',
      startedAt: '2026-11-25T14:30:00.000Z',
      completedAt: '2026-11-25T14:30:05.000Z',
      outcomeCode: 'RATE_LIMIT',
      outcomeMessage: 'Rate limited by upstream',
      remotePostId: null,
    },
  ]),
});
