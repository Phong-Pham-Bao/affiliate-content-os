import type {
  ConsentType,
  IsoTimestamp,
  Publication,
  PublicationApprovalSnapshotId,
  PublicationAttemptId,
  PublicationId,
  PublicationOutcome,
  PublicationStatus,
  ScheduleFacts,
  SocialAccountId,
  SocialPlatform,
  UserId,
  WorkspaceId,
} from '@affiliate-content-os/domain';

export interface PublicationIdempotencyParams {
  readonly rawKey: string;
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
  readonly routeKey: string;
}

export interface CreatePublicationApprovalSnapshotParams {
  readonly workspaceId: WorkspaceId;
  readonly actorUserId: UserId;
  readonly contentApprovalId: string;
  readonly socialAccountId: SocialAccountId;
  readonly videoNumber: number;
  readonly platformSettings: Record<string, unknown>;
  readonly previewHashHex?: string | undefined;
  readonly consent: {
    readonly consentType: ConsentType;
    readonly policyVersion: string;
  };
  readonly idempotency: PublicationIdempotencyParams;
}

export interface CreatePublicationScheduleParams {
  readonly workspaceId: WorkspaceId;
  readonly actorUserId: UserId;
  readonly approvalSnapshotId: PublicationApprovalSnapshotId;
  readonly schedule: ScheduleFacts;
  readonly idempotency: PublicationIdempotencyParams;
}

export interface ReschedulePublicationParams {
  readonly workspaceId: WorkspaceId;
  readonly actorUserId: UserId;
  readonly publicationId: PublicationId;
  readonly expectedVersion: number;
  readonly schedule: ScheduleFacts;
  readonly idempotency: PublicationIdempotencyParams;
}

export interface CancelPublicationParams {
  readonly workspaceId: WorkspaceId;
  readonly actorUserId: UserId;
  readonly publicationId: PublicationId;
  readonly expectedVersion: number;
  readonly idempotency: PublicationIdempotencyParams;
}

export interface ListPublicationsOptions {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly status?: PublicationStatus | undefined;
  readonly socialAccountId?: string | undefined;
  readonly platform?: SocialPlatform | undefined;
}

export interface PaginatedPublications {
  readonly items: readonly Publication[];
  readonly nextCursor: string | null;
}

export interface PublicationAttemptSummary {
  readonly attemptNumber: number;
  readonly status: string;
  readonly phase: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly outcomeCode: string | null;
  readonly outcomeMessage: string | null;
  readonly remotePostId: string | null;
}

export interface PublicationDetail {
  readonly publication: Publication;
  readonly destination: {
    readonly platform: SocialPlatform;
    readonly displayName: string;
    readonly handle: string | null;
  };
  readonly approval: {
    readonly renderedText: string;
    readonly previewHashHex: string;
    readonly approvedAt: string;
    readonly approvedByUserId: string;
  };
  readonly attempts: readonly PublicationAttemptSummary[];
}

export interface ClaimDuePublicationsParams {
  readonly workerId: string;
  readonly maxBatchSize: number;
  readonly leaseDurationSeconds: number;
}

export interface ClaimedPublication {
  readonly publication: Publication;
  readonly leaseToken: string;
}

export interface PrepareAttemptParams {
  readonly workspaceId: WorkspaceId;
  readonly publicationId: PublicationId;
  readonly leaseToken: string;
  readonly workerId: string;
  readonly correlationId: string;
  readonly adapterVersion: string;
}

export type PrepareAttemptResult =
  | {
      readonly kind: 'ready';
      readonly attemptId: PublicationAttemptId;
      readonly attemptNumber: number;
      readonly attemptIdempotencyKey: string;
      readonly requestHashHex: string;
      readonly renderedText: string;
      readonly platformSettings: Record<string, unknown>;
      readonly socialAccountId: SocialAccountId;
      readonly providerAccountId: string;
      readonly decryptedAccessToken?: string | undefined;
    }
  | {
      readonly kind: 'gated_drift';
      readonly reason: string;
      readonly errorCode: string;
      readonly errorMessage: string;
    };

export interface SettleAttemptParams {
  readonly workspaceId: WorkspaceId;
  readonly publicationId: PublicationId;
  readonly leaseToken: string;
  readonly attemptId: PublicationAttemptId;
  readonly attemptNumber: number;
  readonly outcome: PublicationOutcome;
  readonly nextAttemptAt?: IsoTimestamp | undefined;
}

export interface RecoverExpiredLeasesParams {
  readonly workerId: string;
  readonly leaseDurationSeconds?: number | undefined;
}

export interface LeaseRecoveryResult {
  readonly reclaimedCount: number;
  readonly markedUnknownCount: number;
}

export interface PublishTextRequest {
  readonly workspaceId: string;
  readonly publicationId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly attemptIdempotencyKey: string;
  readonly socialAccountId: string;
  readonly providerAccountId: string;
  readonly renderedText: string;
  readonly platformSettings: Record<string, unknown>;
  readonly correlationId: string;
  readonly accessToken?: string | undefined;
}
