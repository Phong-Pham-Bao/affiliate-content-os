import { DomainValidationError } from '@affiliate-content-os/domain';
import type { UserId, WorkspaceId } from '@affiliate-content-os/domain';
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
}

export async function requestScriptChanges(
  persistencePort: WorkforcePersistencePort,
  params: ExecuteRequestScriptChangesParams,
): Promise<ArtifactChangeRequestDTO> {
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
  });
}
