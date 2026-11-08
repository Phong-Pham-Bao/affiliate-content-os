import { createHash } from 'node:crypto';
import {
  validateIdempotencyKey,
  validateScriptPackage,
  type ScriptPackage,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { ContentArtifactDetailDTO } from './workforce-dtos.js';

export interface ExecuteCreateManualRevisionParams {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly actorUserId: UserId;
  readonly expectedVersion: number;
  readonly baseRevisionNumber: number;
  readonly baseContentHashHex: string;
  readonly rawContent: unknown;
  readonly note?: string | undefined;
  readonly idempotencyKey: string;
}

export function computeCanonicalManualRevisionRequestHash(params: {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly expectedVersion: number;
  readonly baseRevisionNumber: number;
  readonly baseContentHashHex: string;
  readonly content: ScriptPackage;
  readonly note?: string | undefined;
}): Uint8Array {
  const canonical = {
    artifactId: params.artifactId,
    baseContentHashHex: params.baseContentHashHex.toLowerCase(),
    baseRevisionNumber: params.baseRevisionNumber,
    content: params.content,
    expectedVersion: params.expectedVersion,
    note: params.note ?? null,
    workspaceId: params.workspaceId,
  };
  return new Uint8Array(createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest());
}

export async function createManualRevision(
  persistencePort: WorkforcePersistencePort,
  params: ExecuteCreateManualRevisionParams,
): Promise<ContentArtifactDetailDTO> {
  const validKey = validateIdempotencyKey(params.idempotencyKey);
  const validatedContent: ScriptPackage = validateScriptPackage(params.rawContent);
  const keyHash = new Uint8Array(createHash('sha256').update(validKey, 'utf8').digest());
  const requestHash = computeCanonicalManualRevisionRequestHash({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    expectedVersion: params.expectedVersion,
    baseRevisionNumber: params.baseRevisionNumber,
    baseContentHashHex: params.baseContentHashHex,
    content: validatedContent,
    note: params.note,
  });
  const routeKey = `POST /api/v1/workspaces/${params.workspaceId}/artifacts/${params.artifactId}/revisions`;

  return persistencePort.createManualRevision({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    actorUserId: params.actorUserId,
    expectedVersion: params.expectedVersion,
    baseRevisionNumber: params.baseRevisionNumber,
    baseContentHashHex: params.baseContentHashHex,
    content: validatedContent,
    note: params.note,
    idempotency: {
      rawKey: validKey,
      keyHash,
      requestHash,
      routeKey,
    },
  });
}
