import type { WorkspaceId } from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { ContentReviewDecisionDTO } from './workforce-dtos.js';

export async function listReviewDecisions(
  persistencePort: WorkforcePersistencePort,
  workspaceId: WorkspaceId,
  artifactId: string,
): Promise<readonly ContentReviewDecisionDTO[]> {
  return persistencePort.listReviewDecisions(workspaceId, artifactId);
}
