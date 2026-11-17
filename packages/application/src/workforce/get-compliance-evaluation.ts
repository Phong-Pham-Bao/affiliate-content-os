import type { WorkspaceId } from '@affiliate-content-os/domain';
import type { WorkforcePersistencePort } from './ports.js';
import type { ComplianceEvaluationDTO } from './workforce-dtos.js';

export async function getComplianceEvaluation(
  persistencePort: WorkforcePersistencePort,
  workspaceId: WorkspaceId,
  artifactId: string,
  revisionNumber?: number | undefined,
): Promise<ComplianceEvaluationDTO | null> {
  return persistencePort.getComplianceEvaluation(workspaceId, artifactId, revisionNumber);
}
