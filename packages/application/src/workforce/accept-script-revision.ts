import { createHash } from 'node:crypto';
import {
  DomainValidationError,
  validateIdempotencyKey,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { AcceptScriptRevisionResult } from './compliance-params-types.js';

export interface ExecuteAcceptScriptRevisionParams {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly actorUserId: UserId;
  readonly expectedVersion: number;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly note?: string | undefined;
  readonly idempotencyKey: string;
}

export function computeCanonicalAcceptRevisionRequestHash(params: {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly expectedVersion: number;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly note?: string | undefined;
}): Uint8Array {
  const canonical = {
    artifactId: params.artifactId,
    contentHashHex: params.contentHashHex.toLowerCase(),
    expectedVersion: params.expectedVersion,
    note: params.note ?? null,
    revisionNumber: params.revisionNumber,
    workspaceId: params.workspaceId,
  };
  return new Uint8Array(createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest());
}

export async function acceptScriptRevision(
  persistencePort: WorkforcePersistencePort,
  params: ExecuteAcceptScriptRevisionParams,
): Promise<AcceptScriptRevisionResult> {
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

  const keyHash = new Uint8Array(createHash('sha256').update(validKey, 'utf8').digest());
  const requestHash = computeCanonicalAcceptRevisionRequestHash({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    expectedVersion: params.expectedVersion,
    revisionNumber: params.revisionNumber,
    contentHashHex: params.contentHashHex,
    note: params.note,
  });
  const routeKey = `POST /api/v1/workspaces/${params.workspaceId}/artifacts/${params.artifactId}/accept`;

  return persistencePort.acceptScriptRevision({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    actorUserId: params.actorUserId,
    expectedVersion: params.expectedVersion,
    revisionNumber: params.revisionNumber,
    contentHashHex: params.contentHashHex.toLowerCase(),
    note: params.note,
    idempotency: {
      rawKey: validKey,
      keyHash,
      requestHash,
      routeKey,
    },
  });
}
