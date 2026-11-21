import type { SocialPlatform } from '../social/types.js';
import type { SocialAccountId } from '../social/ids.js';
import type { WorkspaceId, UserId } from '../ids.js';
import type { IsoTimestamp } from '../timestamps.js';
import type { PublicationApprovalSnapshotId, PublicationId, PublicationAttemptId } from './ids.js';

export const PUBLICATION_STATUSES = [
  'scheduled',
  'queued',
  'publishing',
  'processing_remote',
  'published',
  'retry_wait',
  'outcome_unknown',
  'failed',
  'rejected',
  'canceled',
] as const;

export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

const PUBLICATION_STATUS_SET = new Set<string>(PUBLICATION_STATUSES);
export function isPublicationStatus(value: unknown): value is PublicationStatus {
  return typeof value === 'string' && PUBLICATION_STATUS_SET.has(value);
}

export const TERMINAL_PUBLICATION_STATUSES = [
  'published',
  'failed',
  'rejected',
  'canceled',
] as const;

export type TerminalPublicationStatus = (typeof TERMINAL_PUBLICATION_STATUSES)[number];

const TERMINAL_SET = new Set<string>(TERMINAL_PUBLICATION_STATUSES);
export function isTerminalPublicationStatus(value: unknown): value is TerminalPublicationStatus {
  return typeof value === 'string' && TERMINAL_SET.has(value);
}

export const PUBLICATION_ATTEMPT_PHASES = [
  'prepared',
  'provider_attempt_started',
  'terminal',
] as const;

export type PublicationAttemptPhase = (typeof PUBLICATION_ATTEMPT_PHASES)[number];

const ATTEMPT_PHASE_SET = new Set<string>(PUBLICATION_ATTEMPT_PHASES);
export function isPublicationAttemptPhase(value: unknown): value is PublicationAttemptPhase {
  return typeof value === 'string' && ATTEMPT_PHASE_SET.has(value);
}

export const PUBLICATION_ATTEMPT_STATUSES = [
  'running',
  'succeeded',
  'transient_failure',
  'permanent_failure',
  'outcome_unknown',
] as const;

export type PublicationAttemptStatus = (typeof PUBLICATION_ATTEMPT_STATUSES)[number];

const ATTEMPT_STATUS_SET = new Set<string>(PUBLICATION_ATTEMPT_STATUSES);
export function isPublicationAttemptStatus(value: unknown): value is PublicationAttemptStatus {
  return typeof value === 'string' && ATTEMPT_STATUS_SET.has(value);
}

export const CONSENT_TYPES = ['human_publisher'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export interface ScheduleFacts {
  readonly scheduledAtUtc: IsoTimestamp;
  readonly originalLocalTime: string;
  readonly timezone: string;
}

export interface PublicationApprovalSnapshot {
  readonly id: PublicationApprovalSnapshotId;
  readonly workspaceId: WorkspaceId;
  readonly contentApprovalId: string;
  readonly contentApprovalSnapshotHashHex: string;
  readonly artifactId: string;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly platform: SocialPlatform;
  readonly socialAccountId: SocialAccountId;
  readonly providerAccountId: string;
  readonly accountVersion: number;
  readonly capabilityFingerprintHex: string;
  readonly capabilitiesSnapshot: Record<string, boolean>;
  readonly capabilitiesCheckedAt: string;
  readonly renderedText: string;
  readonly previewHashHex: string;
  readonly disclosureState: Record<string, unknown>;
  readonly platformSettings: Record<string, unknown>;
  readonly approvedByUserId: UserId;
  readonly consentType: ConsentType;
  readonly policyVersion: string;
  readonly policyHashHex: string;
  readonly snapshotJson: Record<string, unknown>;
  readonly snapshotHashHex: string;
  readonly createdAt: string;
}

export interface Publication {
  readonly id: PublicationId;
  readonly workspaceId: WorkspaceId;
  readonly approvalSnapshotId: PublicationApprovalSnapshotId;
  readonly socialAccountId: SocialAccountId;
  readonly platform: SocialPlatform;
  readonly status: PublicationStatus;
  readonly scheduledAtUtc: string;
  readonly originalLocalTime: string;
  readonly timezone: string;
  readonly leaseToken: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
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
  readonly createdByUserId: UserId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface PublicationAttempt {
  readonly id: PublicationAttemptId;
  readonly workspaceId: WorkspaceId;
  readonly publicationId: PublicationId;
  readonly attemptNumber: number;
  readonly attemptIdempotencyKey: string;
  readonly requestHashHex: string;
  readonly adapterVersion: string;
  readonly correlationId: string;
  readonly phase: PublicationAttemptPhase;
  readonly status: PublicationAttemptStatus;
  readonly outcomeCode: string | null;
  readonly outcomeMessage: string | null;
  readonly remotePostId: string | null;
  readonly remotePermalink: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type PublicationOutcome =
  | {
      readonly kind: 'published';
      readonly remotePostId: string;
      readonly remotePermalink: string | null;
      readonly publishedAt: string;
    }
  | {
      readonly kind: 'transient_failure';
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly retryAfterMs?: number | undefined;
    }
  | {
      readonly kind: 'permanent_failure';
      readonly errorCode: string;
      readonly errorMessage: string;
    }
  | {
      readonly kind: 'outcome_unknown';
      readonly errorCode: string;
      readonly errorMessage: string;
    };
