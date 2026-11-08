import type { WorkspaceId } from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { ContentArtifactRevisionDTO } from './workforce-dtos.js';

export async function getArtifactRevisions(
  persistencePort: WorkforcePersistencePort,
  workspaceId: WorkspaceId,
  artifactId: string,
): Promise<readonly ContentArtifactRevisionDTO[]> {
  return persistencePort.getArtifactRevisions(workspaceId, artifactId);
}
