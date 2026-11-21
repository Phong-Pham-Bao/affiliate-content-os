import {
  dateToIsoTimestamp,
  parsePublicationApprovalSnapshotId,
  parsePublicationAttemptId,
  parsePublicationId,
  parseSocialAccountId,
  parseUserId,
  parseWorkspaceId,
  type ConsentType,
  type Publication,
  type PublicationApprovalSnapshot,
  type PublicationAttempt,
  type PublicationAttemptPhase,
  type PublicationAttemptStatus,
  type PublicationStatus,
  type SocialPlatform,
} from '@affiliate-content-os/domain';

export interface PublicationApprovalSnapshotRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly content_approval_id: string;
  readonly content_approval_snapshot_hash: Buffer;
  readonly artifact_id: string;
  readonly revision_number: number;
  readonly content_hash: Buffer;
  readonly platform: SocialPlatform;
  readonly social_account_id: string;
  readonly provider_account_id: string;
  readonly account_version: string | number;
  readonly capability_fingerprint: Buffer;
  readonly capabilities_snapshot_json: Record<string, boolean>;
  readonly capabilities_checked_at: Date | string;
  readonly rendered_text: string;
  readonly preview_hash: Buffer;
  readonly disclosure_state_json: Record<string, unknown>;
  readonly platform_settings_json: Record<string, unknown>;
  readonly approved_by_user_id: string;
  readonly consent_type: ConsentType;
  readonly policy_version: string;
  readonly policy_hash: Buffer;
  readonly snapshot_json: Record<string, unknown>;
  readonly snapshot_hash: Buffer;
  readonly created_at: Date | string;
}

export function mapPublicationApprovalSnapshotRow(
  row: PublicationApprovalSnapshotRow,
): PublicationApprovalSnapshot {
  return {
    id: parsePublicationApprovalSnapshotId(row.id),
    workspaceId: parseWorkspaceId(row.workspace_id),
    contentApprovalId: row.content_approval_id,
    contentApprovalSnapshotHashHex: row.content_approval_snapshot_hash.toString('hex'),
    artifactId: row.artifact_id,
    revisionNumber: row.revision_number,
    contentHashHex: row.content_hash.toString('hex'),
    platform: row.platform,
    socialAccountId: parseSocialAccountId(row.social_account_id),
    providerAccountId: row.provider_account_id,
    accountVersion: Number(row.account_version),
    capabilityFingerprintHex: row.capability_fingerprint.toString('hex'),
    capabilitiesSnapshot: row.capabilities_snapshot_json,
    capabilitiesCheckedAt: dateToIsoTimestamp(new Date(row.capabilities_checked_at)),
    renderedText: row.rendered_text,
    previewHashHex: row.preview_hash.toString('hex'),
    disclosureState: row.disclosure_state_json ?? {},
    platformSettings: row.platform_settings_json ?? {},
    approvedByUserId: parseUserId(row.approved_by_user_id),
    consentType: row.consent_type,
    policyVersion: row.policy_version,
    policyHashHex: row.policy_hash.toString('hex'),
    snapshotJson: row.snapshot_json ?? {},
    snapshotHashHex: row.snapshot_hash.toString('hex'),
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
  };
}

export interface PublicationRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly approval_snapshot_id: string;
  readonly social_account_id: string;
  readonly platform: SocialPlatform;
  readonly status: PublicationStatus;
  readonly scheduled_at_utc: Date | string;
  readonly original_local_time: string;
  readonly timezone: string;
  readonly lease_token: string | null;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | string | null;
  readonly current_attempt_number: number;
  readonly max_attempts: number;
  readonly next_attempt_at: Date | string;
  readonly remote_post_id: string | null;
  readonly remote_permalink: string | null;
  readonly published_at: Date | string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly gated_reason: string | null;
  readonly completed_at: Date | string | null;
  readonly created_by_user_id: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly version: string | number;
}

export function mapPublicationRow(row: PublicationRow): Publication {
  return {
    id: parsePublicationId(row.id),
    workspaceId: parseWorkspaceId(row.workspace_id),
    approvalSnapshotId: parsePublicationApprovalSnapshotId(row.approval_snapshot_id),
    socialAccountId: parseSocialAccountId(row.social_account_id),
    platform: row.platform,
    status: row.status,
    scheduledAtUtc: dateToIsoTimestamp(new Date(row.scheduled_at_utc)),
    originalLocalTime: row.original_local_time,
    timezone: row.timezone,
    leaseToken: row.lease_token,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at
      ? dateToIsoTimestamp(new Date(row.lease_expires_at))
      : null,
    currentAttemptNumber: row.current_attempt_number,
    maxAttempts: row.max_attempts,
    nextAttemptAt: dateToIsoTimestamp(new Date(row.next_attempt_at)),
    remotePostId: row.remote_post_id,
    remotePermalink: row.remote_permalink,
    publishedAt: row.published_at ? dateToIsoTimestamp(new Date(row.published_at)) : null,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    gatedReason: row.gated_reason,
    completedAt: row.completed_at ? dateToIsoTimestamp(new Date(row.completed_at)) : null,
    createdByUserId: parseUserId(row.created_by_user_id),
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
    updatedAt: dateToIsoTimestamp(new Date(row.updated_at)),
    version: Number(row.version),
  };
}

export interface PublicationAttemptRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly publication_id: string;
  readonly attempt_number: number;
  readonly attempt_idempotency_key: string;
  readonly request_hash: Buffer;
  readonly adapter_version: string;
  readonly correlation_id: string;
  readonly phase: PublicationAttemptPhase;
  readonly status: PublicationAttemptStatus;
  readonly outcome_code: string | null;
  readonly outcome_message: string | null;
  readonly remote_post_id: string | null;
  readonly remote_permalink: string | null;
  readonly started_at: Date | string;
  readonly completed_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly version: string | number;
}

export function mapPublicationAttemptRow(row: PublicationAttemptRow): PublicationAttempt {
  return {
    id: parsePublicationAttemptId(row.id),
    workspaceId: parseWorkspaceId(row.workspace_id),
    publicationId: parsePublicationId(row.publication_id),
    attemptNumber: row.attempt_number,
    attemptIdempotencyKey: row.attempt_idempotency_key,
    requestHashHex: row.request_hash.toString('hex'),
    adapterVersion: row.adapter_version,
    correlationId: row.correlation_id,
    phase: row.phase,
    status: row.status,
    outcomeCode: row.outcome_code,
    outcomeMessage: row.outcome_message,
    remotePostId: row.remote_post_id,
    remotePermalink: row.remote_permalink,
    startedAt: dateToIsoTimestamp(new Date(row.started_at)),
    completedAt: row.completed_at ? dateToIsoTimestamp(new Date(row.completed_at)) : null,
    createdAt: dateToIsoTimestamp(new Date(row.created_at)),
    updatedAt: dateToIsoTimestamp(new Date(row.updated_at)),
    version: Number(row.version),
  };
}
