import type {
  Publication,
  PublicationApprovalSnapshot,
  PublicationApprovalSnapshotId,
  PublicationId,
  PublicationOutcome,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type {
  CancelPublicationParams,
  ClaimDuePublicationsParams,
  ClaimedPublication,
  CreatePublicationApprovalSnapshotParams,
  CreatePublicationScheduleParams,
  LeaseRecoveryResult,
  ListPublicationsOptions,
  PaginatedPublications,
  PrepareAttemptParams,
  PrepareAttemptResult,
  PublicationDetail,
  PublishTextRequest,
  RecoverExpiredLeasesParams,
  ReschedulePublicationParams,
  SettleAttemptParams,
} from './types.js';

export * from './types.js';

export interface PublicationPersistencePort {
  createApprovalSnapshotTransaction(
    params: CreatePublicationApprovalSnapshotParams,
  ): Promise<PublicationApprovalSnapshot>;

  findApprovalSnapshotById(
    workspaceId: WorkspaceId,
    snapshotId: PublicationApprovalSnapshotId,
  ): Promise<PublicationApprovalSnapshot | null>;

  createPublicationScheduleTransaction(
    params: CreatePublicationScheduleParams,
  ): Promise<Publication>;

  findPublicationById(
    workspaceId: WorkspaceId,
    publicationId: PublicationId,
  ): Promise<Publication | null>;

  findPublicationDetail(
    workspaceId: WorkspaceId,
    publicationId: PublicationId,
  ): Promise<PublicationDetail | null>;

  listPublications(
    workspaceId: WorkspaceId,
    options: ListPublicationsOptions,
  ): Promise<PaginatedPublications>;

  reschedulePublicationTransaction(params: ReschedulePublicationParams): Promise<Publication>;

  cancelPublicationTransaction(params: CancelPublicationParams): Promise<Publication>;

  claimDuePublications(params: ClaimDuePublicationsParams): Promise<readonly ClaimedPublication[]>;

  prepareAttemptTransaction(params: PrepareAttemptParams): Promise<PrepareAttemptResult>;

  settleAttemptTransaction(params: SettleAttemptParams): Promise<void>;

  recoverExpiredLeases(params: RecoverExpiredLeasesParams): Promise<LeaseRecoveryResult>;
}

export interface SocialPublicationAdapter {
  publishText(request: PublishTextRequest): Promise<PublicationOutcome>;
}
