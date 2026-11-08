import { createHash } from 'node:crypto';
import {
  DomainValidationError,
  validateIdempotencyKey,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { ArtifactChangeRequestDTO } from './workforce-dtos.js';

export interface ExecuteRequestScriptChangesParams {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly actorUserId: UserId;
  readonly expectedVersion: number;
  readonly baseRevisionNumber: number;
  readonly baseContentHashHex: string;
  readonly instructionText: string;
  readonly selectedVideoNumbers: readonly number[];
  readonly targetVariantCount?: number | undefined;
  readonly idempotencyKey: string;
}

export function computeCanonicalRequestChangesRequestHash(params: {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly expectedVersion: number;
  readonly baseRevisionNumber: number;
  readonly baseContentHashHex: string;
  readonly instructionText: string;
  readonly selectedVideoNumbers: readonly number[];
  readonly targetVariantCount: number;
}): Uint8Array {
  const canonical = {
    artifactId: params.artifactId,
    baseContentHashHex: params.baseContentHashHex.toLowerCase(),
    baseRevisionNumber: params.baseRevisionNumber,
    expectedVersion: params.expectedVersion,
    instructionText: params.instructionText,
    selectedVideoNumbers: [...params.selectedVideoNumbers].sort((a, b) => a - b),
    targetVariantCount: params.targetVariantCount,
    workspaceId: params.workspaceId,
  };
  return new Uint8Array(createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest());
}

export async function requestScriptChanges(
  persistencePort: WorkforcePersistencePort,
  params: ExecuteRequestScriptChangesParams,
): Promise<ArtifactChangeRequestDTO> {
  const validKey = validateIdempotencyKey(params.idempotencyKey);
  const instruction = params.instructionText.trim();
  if (instruction.length === 0 || instruction.length > 2000) {
    throw new DomainValidationError(
      'instructionText must be between 1 and 2000 characters',
      'instructionText',
    );
  }

  if (
    !Array.isArray(params.selectedVideoNumbers) ||
    params.selectedVideoNumbers.length === 0 ||
    params.selectedVideoNumbers.length > 5
  ) {
    throw new DomainValidationError(
      'selectedVideoNumbers must contain between 1 and 5 video numbers',
      'selectedVideoNumbers',
    );
  }

  const uniqueNums = new Set<number>();
  for (const n of params.selectedVideoNumbers) {
    if (![1, 2, 3, 4, 5].includes(n)) {
      throw new DomainValidationError(
        'Each selected video number must be between 1 and 5',
        'selectedVideoNumbers',
      );
    }
    uniqueNums.add(n);
  }

  const selectedVideos = Array.from(uniqueNums).sort((a, b) => a - b) as readonly (
    1 | 2 | 3 | 4 | 5
  )[];

  const variantCount = params.targetVariantCount ?? 1;
  if (![1, 2, 3].includes(variantCount)) {
    throw new DomainValidationError(
      'targetVariantCount must be between 1 and 3',
      'targetVariantCount',
    );
  }

  const keyHash = new Uint8Array(createHash('sha256').update(validKey, 'utf8').digest());
  const requestHash = computeCanonicalRequestChangesRequestHash({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    expectedVersion: params.expectedVersion,
    baseRevisionNumber: params.baseRevisionNumber,
    baseContentHashHex: params.baseContentHashHex,
    instructionText: instruction,
    selectedVideoNumbers: selectedVideos,
    targetVariantCount: variantCount,
  });
  const routeKey = `POST /api/v1/workspaces/${params.workspaceId}/artifacts/${params.artifactId}/request-changes`;

  return persistencePort.requestScriptChanges({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    actorUserId: params.actorUserId,
    expectedVersion: params.expectedVersion,
    baseRevisionNumber: params.baseRevisionNumber,
    baseContentHashHex: params.baseContentHashHex,
    instructionText: instruction,
    selectedVideoNumbers: selectedVideos,
    targetVariantCount: variantCount,
    idempotency: {
      rawKey: validKey,
      keyHash,
      requestHash,
      routeKey,
    },
  });
}
