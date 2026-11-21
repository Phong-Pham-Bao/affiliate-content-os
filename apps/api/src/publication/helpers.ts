import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  computeCanonicalHash,
  DomainValidationError,
  validateIdempotencyKey,
} from '@affiliate-content-os/domain';
import { AuthOriginInvalidError, validateOrigin } from '../auth/origin.js';
import { MalformedIdempotencyKeyError } from '../catalog/errors.js';
import type { PublicationRouteDependencies } from './types.js';

export function validatePublicationMutationOrigin(
  request: FastifyRequest,
  deps: PublicationRouteDependencies,
): void {
  const originHeader = request.headers['origin'];
  if (typeof originHeader !== 'string' || originHeader === 'null' || originHeader.trim() === '') {
    throw new AuthOriginInvalidError();
  }
  const appBaseUrl = deps.auth.appBaseUrl ?? 'http://127.0.0.1:3000';
  const redirectUri = deps.auth.config.redirectUri ?? appBaseUrl;
  validateOrigin(originHeader, appBaseUrl, redirectUri);
}

export function extractPublicationIdempotencyKey(request: FastifyRequest): {
  rawKey: string;
  keyHash: Uint8Array;
} {
  const rawKey = request.headers['idempotency-key'];
  if (typeof rawKey !== 'string' || rawKey.trim() === '') {
    throw new MalformedIdempotencyKeyError();
  }
  try {
    const validKey = validateIdempotencyKey(rawKey);
    const keyHash = crypto.createHash('sha256').update(validKey).digest();
    return { rawKey: validKey, keyHash: new Uint8Array(keyHash) };
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new MalformedIdempotencyKeyError();
    }
    throw err;
  }
}

export function computeCreatePublicationApprovalRequestHash(params: {
  readonly workspaceId: string;
  readonly contentApprovalId: string;
  readonly socialAccountId: string;
  readonly videoNumber: number;
  readonly platformSettings: Record<string, unknown>;
  readonly previewHashHex?: string | undefined;
  readonly consent: {
    readonly consentType: string;
    readonly policyVersion: string;
  };
}): Uint8Array {
  return computeCanonicalHash({
    consent: {
      consentType: params.consent.consentType,
      policyVersion: params.consent.policyVersion,
    },
    contentApprovalId: params.contentApprovalId,
    platformSettings: params.platformSettings,
    previewHashHex: params.previewHashHex ?? null,
    socialAccountId: params.socialAccountId,
    videoNumber: params.videoNumber,
    workspaceId: params.workspaceId,
  });
}

export function computeCreatePublicationScheduleRequestHash(params: {
  readonly workspaceId: string;
  readonly approvalSnapshotId: string;
  readonly schedule: {
    readonly scheduledAtUtc: string;
    readonly originalLocalTime: string;
    readonly timezone: string;
  };
}): Uint8Array {
  return computeCanonicalHash({
    approvalSnapshotId: params.approvalSnapshotId,
    schedule: {
      originalLocalTime: params.schedule.originalLocalTime,
      scheduledAtUtc: params.schedule.scheduledAtUtc,
      timezone: params.schedule.timezone,
    },
    workspaceId: params.workspaceId,
  });
}

export function computeReschedulePublicationRequestHash(params: {
  readonly workspaceId: string;
  readonly publicationId: string;
  readonly expectedVersion: number;
  readonly schedule: {
    readonly scheduledAtUtc: string;
    readonly originalLocalTime: string;
    readonly timezone: string;
  };
}): Uint8Array {
  return computeCanonicalHash({
    expectedVersion: params.expectedVersion,
    publicationId: params.publicationId,
    schedule: {
      originalLocalTime: params.schedule.originalLocalTime,
      scheduledAtUtc: params.schedule.scheduledAtUtc,
      timezone: params.schedule.timezone,
    },
    workspaceId: params.workspaceId,
  });
}

export function computeCancelPublicationRequestHash(params: {
  readonly workspaceId: string;
  readonly publicationId: string;
  readonly expectedVersion: number;
}): Uint8Array {
  return computeCanonicalHash({
    expectedVersion: params.expectedVersion,
    publicationId: params.publicationId,
    workspaceId: params.workspaceId,
  });
}
