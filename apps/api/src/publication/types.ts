import type { SocialConfig } from '@affiliate-content-os/config';
import type {
  ClockPort,
  IdGeneratorPort,
  IdempotencyStorePort,
  PublicationPersistencePort,
  SocialPublicationAdapter,
  WorkspaceAuthorizationPort,
} from '@affiliate-content-os/application';
import type {
  ConsentType,
  PublicationAttemptPhase,
  PublicationAttemptStatus,
  PublicationStatus,
  SocialPlatform,
} from '@affiliate-content-os/domain';
import type { AuthDependencies } from '../auth/types.js';

export interface PublicationRouteDependencies {
  readonly auth: AuthDependencies;
  readonly socialConfig: SocialConfig;
  readonly publicationPersistence: PublicationPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly publicationAdapter?: SocialPublicationAdapter | undefined;
  readonly idempotencyStore?: IdempotencyStorePort | undefined;
  readonly clock?: ClockPort | undefined;
  readonly idGenerator?: IdGeneratorPort | undefined;
}

export interface PublicationApprovalSnapshotDto {
  readonly id: string;
  readonly workspaceId: string;
  readonly contentApprovalId: string;
  readonly contentApprovalSnapshotHashHex: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly platform: SocialPlatform;
  readonly socialAccountId: string;
  readonly providerAccountId: string;
  readonly accountVersion: number;
  readonly capabilityFingerprintHex: string;
  readonly capabilitiesSnapshot: Record<string, boolean>;
  readonly capabilitiesCheckedAt: string;
  readonly renderedText: string;
  readonly previewHashHex: string;
  readonly disclosureState: Record<string, unknown>;
  readonly platformSettings: Record<string, unknown>;
  readonly approvedByUserId: string;
  readonly consentType: ConsentType;
  readonly policyVersion: string;
  readonly policyHashHex: string;
  readonly snapshotJson: Record<string, unknown>;
  readonly snapshotHashHex: string;
  readonly createdAt: string;
}

export interface PublicationDto {
  readonly id: string;
  readonly workspaceId: string;
  readonly approvalSnapshotId: string;
  readonly socialAccountId: string;
  readonly platform: SocialPlatform;
  readonly status: PublicationStatus;
  readonly scheduledAtUtc: string;
  readonly originalLocalTime: string;
  readonly timezone: string;
  readonly currentAttemptNumber: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string;
  readonly remotePostId: string | null;
  readonly remotePermalink: string | null;
  readonly publishedAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly gatedReason: string | null;
  readonly completedAt: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface PublicationAttemptSummaryDto {
  readonly attemptNumber: number;
  readonly status: PublicationAttemptStatus;
  readonly phase: PublicationAttemptPhase;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly outcomeCode: string | null;
  readonly outcomeMessage: string | null;
  readonly remotePostId: string | null;
}

export interface PublicationDestinationSummaryDto {
  readonly platform: SocialPlatform;
  readonly displayName: string;
  readonly handle: string | null;
}

export interface PublicationApprovalSummaryDto {
  readonly renderedText: string;
  readonly previewHashHex: string;
  readonly approvedAt: string;
  readonly approvedByUserId: string;
}

export interface PublicationDetailDto {
  readonly publication: PublicationDto;
  readonly destination: PublicationDestinationSummaryDto;
  readonly approval: PublicationApprovalSummaryDto;
  readonly attempts: readonly PublicationAttemptSummaryDto[];
}

export interface PublicationListDto {
  readonly items: readonly PublicationDto[];
  readonly nextCursor: string | null;
}
