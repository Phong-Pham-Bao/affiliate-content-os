import {
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
}

export async function createManualRevision(
  persistencePort: WorkforcePersistencePort,
  params: ExecuteCreateManualRevisionParams,
): Promise<ContentArtifactDetailDTO> {
  const validatedContent: ScriptPackage = validateScriptPackage(params.rawContent);
  return persistencePort.createManualRevision({
    workspaceId: params.workspaceId,
    artifactId: params.artifactId,
    actorUserId: params.actorUserId,
    expectedVersion: params.expectedVersion,
    baseRevisionNumber: params.baseRevisionNumber,
    baseContentHashHex: params.baseContentHashHex,
    content: validatedContent,
    note: params.note,
  });
}
