import type {
  Publication,
  PublicationApprovalSnapshot,
  PublicationAttemptPhase,
  PublicationAttemptStatus,
} from '@affiliate-content-os/domain';
import type {
  PaginatedPublications,
  PublicationAttemptSummary,
  PublicationDetail,
} from '@affiliate-content-os/application';
import type {
  PublicationApprovalSnapshotDto,
  PublicationAttemptSummaryDto,
  PublicationDetailDto,
  PublicationDto,
  PublicationListDto,
} from './types.js';

/**
 * Serializes a PublicationApprovalSnapshot domain entity into a safe external DTO.
 * Guarantees no sensitive credentials or internal secrets are exposed.
 */
export function serializePublicationApprovalSnapshot(
  snapshot: PublicationApprovalSnapshot,
): PublicationApprovalSnapshotDto {
  return Object.freeze({
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    contentApprovalId: snapshot.contentApprovalId,
    contentApprovalSnapshotHashHex: snapshot.contentApprovalSnapshotHashHex,
    artifactId: snapshot.artifactId,
    revisionNumber: snapshot.revisionNumber,
    contentHashHex: snapshot.contentHashHex,
    platform: snapshot.platform,
    socialAccountId: snapshot.socialAccountId,
    providerAccountId: snapshot.providerAccountId,
    accountVersion: snapshot.accountVersion,
    capabilityFingerprintHex: snapshot.capabilityFingerprintHex,
    capabilitiesSnapshot: Object.freeze({ ...snapshot.capabilitiesSnapshot }),
    capabilitiesCheckedAt: snapshot.capabilitiesCheckedAt,
    renderedText: snapshot.renderedText,
    previewHashHex: snapshot.previewHashHex,
    disclosureState: Object.freeze({ ...snapshot.disclosureState }),
    platformSettings: Object.freeze({ ...snapshot.platformSettings }),
    approvedByUserId: snapshot.approvedByUserId,
    consentType: snapshot.consentType,
    policyVersion: snapshot.policyVersion,
    policyHashHex: snapshot.policyHashHex,
    snapshotJson: Object.freeze({ ...snapshot.snapshotJson }),
    snapshotHashHex: snapshot.snapshotHashHex,
    createdAt: snapshot.createdAt,
  });
}

/**
 * Serializes a Publication entity into a safe external DTO.
 * Explicitly omits internal lease tokens, lease owners, and lease expiry.
 */
export function serializePublication(publication: Publication): PublicationDto {
  return Object.freeze({
    id: publication.id,
    workspaceId: publication.workspaceId,
    approvalSnapshotId: publication.approvalSnapshotId,
    socialAccountId: publication.socialAccountId,
    platform: publication.platform,
    status: publication.status,
    scheduledAtUtc: publication.scheduledAtUtc,
    originalLocalTime: publication.originalLocalTime,
    timezone: publication.timezone,
    currentAttemptNumber: publication.currentAttemptNumber,
    maxAttempts: publication.maxAttempts,
    nextAttemptAt: publication.nextAttemptAt,
    remotePostId: publication.remotePostId,
    remotePermalink: publication.remotePermalink,
    publishedAt: publication.publishedAt,
    lastErrorCode: publication.lastErrorCode,
    lastErrorMessage: publication.lastErrorMessage,
    gatedReason: publication.gatedReason,
    completedAt: publication.completedAt,
    createdByUserId: publication.createdByUserId,
    createdAt: publication.createdAt,
    updatedAt: publication.updatedAt,
    version: publication.version,
  });
}

/**
 * Serializes an attempt summary into a safe external DTO.
 * Omits attemptIdempotencyKey, requestHashHex, correlationId, adapterVersion.
 */
export function serializePublicationAttemptSummary(
  attempt: PublicationAttemptSummary,
): PublicationAttemptSummaryDto {
  return Object.freeze({
    attemptNumber: attempt.attemptNumber,
    status: attempt.status as PublicationAttemptStatus,
    phase: attempt.phase as PublicationAttemptPhase,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    outcomeCode: attempt.outcomeCode,
    outcomeMessage: attempt.outcomeMessage,
    remotePostId: attempt.remotePostId,
  });
}

/**
 * Serializes a detailed publication view into a safe external DTO.
 */
export function serializePublicationDetail(detail: PublicationDetail): PublicationDetailDto {
  return Object.freeze({
    publication: serializePublication(detail.publication),
    destination: Object.freeze({
      platform: detail.destination.platform,
      displayName: detail.destination.displayName,
      handle: detail.destination.handle,
    }),
    approval: Object.freeze({
      renderedText: detail.approval.renderedText,
      previewHashHex: detail.approval.previewHashHex,
      approvedAt: detail.approval.approvedAt,
      approvedByUserId: detail.approval.approvedByUserId,
    }),
    attempts: Object.freeze(detail.attempts.map(serializePublicationAttemptSummary)),
  });
}

/**
 * Serializes a paginated publication list into a safe external DTO.
 */
export function serializePublicationList(paginated: PaginatedPublications): PublicationListDto {
  return Object.freeze({
    items: Object.freeze(paginated.items.map(serializePublication)),
    nextCursor: paginated.nextCursor,
  });
}
