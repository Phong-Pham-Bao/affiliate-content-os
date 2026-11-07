import {
  canWorkspaceRole,
  parseAnalysisId,
  parseUserId,
  parseWorkspaceId,
  type AnalysisSnapshot,
} from '@affiliate-content-os/domain';
import { AnalysisNotFoundError } from './errors.js';
import { WorkspaceAccessDeniedError } from '../errors.js';
import type { GetAnalysisDependencies, GetAnalysisQuery } from './types.js';

export { type GetAnalysisDependencies, type GetAnalysisQuery };

export async function getAnalysis(
  query: GetAnalysisQuery,
  deps: GetAnalysisDependencies,
): Promise<AnalysisSnapshot> {
  const wsId = parseWorkspaceId(query.workspaceId);
  const analysisId = parseAnalysisId(query.analysisId);
  const actorId = parseUserId(query.actorUserId);

  const membership = await deps.authPort.findMembership({
    workspaceId: wsId,
    userId: actorId,
  });
  if (!membership || membership.status !== 'active') {
    throw new WorkspaceAccessDeniedError();
  }
  if (!canWorkspaceRole(membership.role, 'catalog.read')) {
    throw new WorkspaceAccessDeniedError();
  }

  const analysis = await deps.analysisPort.getAnalysisById(wsId, analysisId);
  if (!analysis) {
    throw new AnalysisNotFoundError(query.analysisId);
  }

  return analysis;
}
