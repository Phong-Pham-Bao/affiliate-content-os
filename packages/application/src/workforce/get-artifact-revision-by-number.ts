import type { WorkspaceId } from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { ContentArtifactDetailDTO } from './workforce-dtos.js';

export async function getArtifactRevisionByNumber(
  persistencePort: WorkforcePersistencePort,
  workspaceId: WorkspaceId,
  artifactId: string,
  revisionNumber: number,
): Promise<ContentArtifactDetailDTO | null> {
  return persistencePort.getArtifactRevisionByNumber(workspaceId, artifactId, revisionNumber);
}
