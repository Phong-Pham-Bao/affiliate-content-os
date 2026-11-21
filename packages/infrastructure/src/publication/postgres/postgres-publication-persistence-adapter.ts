import type {
  Publication,
  PublicationApprovalSnapshot,
  PublicationApprovalSnapshotId,
  PublicationId,
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
  PublicationPersistencePort,
  RecoverExpiredLeasesParams,
  ReschedulePublicationParams,
  SettleAttemptParams,
  SocialCredentialProtectorPort,
} from '@affiliate-content-os/application';
import type { Database } from '../../database/types.js';
import {
  executeCreateApprovalSnapshotTransaction,
  executeFindApprovalSnapshotById,
} from './publication-approval-transactions.js';
import {
  executeCreatePublicationScheduleTransaction,
  executeFindPublicationById,
  executeFindPublicationDetail,
  executeListPublications,
} from './publication-schedule-transactions.js';
import {
  executeCancelPublicationTransaction,
  executeReschedulePublicationTransaction,
} from './publication-mutation-transactions.js';
import {
  executeClaimDuePublications,
  executeRecoverExpiredLeases,
} from './publication-claim-transactions.js';
import {
  executePrepareAttemptTransaction,
  executeSettleAttemptTransaction,
} from './publication-attempt-transactions.js';

export class PostgresPublicationPersistenceAdapter implements PublicationPersistencePort {
  constructor(
    private readonly database: Database,
    private readonly protector?: SocialCredentialProtectorPort,
  ) {}

  public async createApprovalSnapshotTransaction(
    params: CreatePublicationApprovalSnapshotParams,
  ): Promise<PublicationApprovalSnapshot> {
    return executeCreateApprovalSnapshotTransaction(this.database, params);
  }

  public async findApprovalSnapshotById(
    workspaceId: WorkspaceId,
    snapshotId: PublicationApprovalSnapshotId,
  ): Promise<PublicationApprovalSnapshot | null> {
    return executeFindApprovalSnapshotById(this.database, workspaceId, snapshotId);
  }

  public async createPublicationScheduleTransaction(
    params: CreatePublicationScheduleParams,
  ): Promise<Publication> {
    return executeCreatePublicationScheduleTransaction(this.database, params);
  }

  public async findPublicationById(
    workspaceId: WorkspaceId,
    publicationId: PublicationId,
  ): Promise<Publication | null> {
    return executeFindPublicationById(this.database, workspaceId, publicationId);
  }

  public async findPublicationDetail(
    workspaceId: WorkspaceId,
    publicationId: PublicationId,
  ): Promise<PublicationDetail | null> {
    return executeFindPublicationDetail(this.database, workspaceId, publicationId);
  }

  public async listPublications(
    workspaceId: WorkspaceId,
    options: ListPublicationsOptions,
  ): Promise<PaginatedPublications> {
    return executeListPublications(this.database, workspaceId, options);
  }

  public async reschedulePublicationTransaction(
    params: ReschedulePublicationParams,
  ): Promise<Publication> {
    return executeReschedulePublicationTransaction(this.database, params);
  }

  public async cancelPublicationTransaction(params: CancelPublicationParams): Promise<Publication> {
    return executeCancelPublicationTransaction(this.database, params);
  }

  public async claimDuePublications(
    params: ClaimDuePublicationsParams,
  ): Promise<readonly ClaimedPublication[]> {
    return executeClaimDuePublications(this.database, params);
  }

  public async prepareAttemptTransaction(
    params: PrepareAttemptParams,
  ): Promise<PrepareAttemptResult> {
    return executePrepareAttemptTransaction(this.database, params, this.protector);
  }

  public async settleAttemptTransaction(params: SettleAttemptParams): Promise<void> {
    return executeSettleAttemptTransaction(this.database, params);
  }

  public async recoverExpiredLeases(
    params: RecoverExpiredLeasesParams,
  ): Promise<LeaseRecoveryResult> {
    return executeRecoverExpiredLeases(this.database, params);
  }
}
