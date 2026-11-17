import { createHash } from 'node:crypto';
import {
  DomainValidationError,
  validateIdempotencyKey,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { RejectScriptRevisionResult } from './compliance-params-types.js';

export interface ExecuteRejectScriptRevisionParams {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly actorUserId: UserId;
  readonly expectedVersion: number;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export function computeCanonicalRejectRevisionRequestHash(params: {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly expectedVersion: number;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly reason: string;
}): Uint8Array {
  const canonical = {
    artifactId: params.artifactId,
    contentHashHex: params.contentHashHex.toLowerCase(),
    expectedVersion: params.expectedVersion,
    reason: params.reason,
    revisionNumber: params.revisionNumber,
    workspaceId: params.workspaceId,
  };
  return new Uint8Array(createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest());
}

export async function rejectScriptRevision(
  persistencePort: WorkforcePersistencePort,
  params: ExecuteRejectScriptRevisionParams,
): Promise<RejectScriptRevisionResult> {
  const validKey = validateIdempotencyKey(params.idempotencyKey);
  if (!params.contentHashHex || params.contentHashHex.trim().length !== 64) {
    throw new DomainValidationError('Content hash must be a 64-character hex string');
  }
  if (!Number.isInteger(params.revisionNumber) || params.revisionNumber < 1) {
    throw new DomainValidationError('Revision number must be a positive integer');
  }
  if (!Number.isInteger(params.expectedVersion) || params.expectedVersion < 1) {
    throw new DomainValidationError('Expected version must be a positive integer');
  }
  if (
    typeof params.reason !== 'string' ||
    params.reason.trim().length < 1 ||
    params.reason.trim().length > 2000
  ) {
    throw new DomainValidationError('Reject reason must be between 1 and 2000 characters');
  }

  const keyHash = new Uint8Array(createHash('sha256').update(validKey, 'utf8').digest());
  const trimmedReason = params.reason.trim();
  const requestHash = computeCanonicalRejectRevisionRequestHash({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    expectedVersion: params.expectedVersion,
    revisionNumber: params.revisionNumber,
    contentHashHex: params.contentHashHex,
    reason: trimmedReason,
  });
  const routeKey = `POST /api/v1/workspaces/${params.workspaceId}/artifacts/${params.artifactId}/reject`;

  return persistencePort.rejectScriptRevision({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    actorUserId: params.actorUserId,
    expectedVersion: params.expectedVersion,
    revisionNumber: params.revisionNumber,
    contentHashHex: params.contentHashHex.toLowerCase(),
    reason: trimmedReason,
    idempotency: {
      rawKey: validKey,
      keyHash,
      requestHash,
      routeKey,
    },
  });
}
