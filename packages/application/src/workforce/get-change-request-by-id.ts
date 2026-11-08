import type { WorkspaceId } from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { ArtifactChangeRequestDTO } from './workforce-dtos.js';

export async function getChangeRequestById(
  persistencePort: WorkforcePersistencePort,
  workspaceId: WorkspaceId,
  artifactId: string,
  changeRequestId: string,
): Promise<ArtifactChangeRequestDTO | null> {
  return persistencePort.getChangeRequestById(workspaceId, artifactId, changeRequestId);
}
