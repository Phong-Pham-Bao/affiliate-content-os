import {
  canWorkspaceRole,
  dateToIsoTimestamp,
  parseAnalysisId,
  parseAuditEventId,
  parseUserId,
  parseWorkspaceId,
  type AnalysisSnapshot,
} from '@affiliate-content-os/domain';
import { ValidationError, WorkspaceAccessDeniedError } from '../errors.js';
import { generateUuidV7 } from '../id-generator.js';
import type { ReviewAnalysisCommand, ReviewAnalysisDependencies } from './types.js';

export { type ReviewAnalysisCommand, type ReviewAnalysisDependencies };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

export async function reviewAnalysis(
  command: ReviewAnalysisCommand,
  deps: ReviewAnalysisDependencies,
): Promise<AnalysisSnapshot> {
  const wsId = parseWorkspaceId(command.workspaceId);
  const analysisId = parseAnalysisId(command.analysisId);
  const actorId = parseUserId(command.actorUserId);

  if (command.decision !== 'accepted' && command.decision !== 'rejected') {
    throw new ValidationError('decision must be "accepted" or "rejected"', 'decision');
  }

  if (
    typeof command.expectedVersion !== 'number' ||
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 1
  ) {
    throw new ValidationError('expectedVersion must be a positive safe integer', 'expectedVersion');
  }

  let sanitizedReason: string | null = null;
  if (command.reason !== undefined && command.reason !== null) {
    if (typeof command.reason !== 'string') {
      throw new ValidationError('reason must be a string', 'reason');
    }
    const trimmed = command.reason.trim();
    if (trimmed.length > 2048) {
      throw new ValidationError('reason exceeds maximum length of 2048 characters', 'reason');
    }
    if (CONTROL_CHARS_REGEX.test(trimmed)) {
      throw new ValidationError('reason must not contain control characters', 'reason');
    }
    sanitizedReason = trimmed.length > 0 ? trimmed : null;
  }

  // 1. Authorize
  const membership = await deps.authPort.findMembership({
    workspaceId: wsId,
    userId: actorId,
  });
  if (!membership || membership.status !== 'active') {
    throw new WorkspaceAccessDeniedError();
  }
  if (!canWorkspaceRole(membership.role, 'catalog.manage')) {
    throw new WorkspaceAccessDeniedError();
  }

  // 2. Perform atomic review and audit event insertion
  const now = dateToIsoTimestamp(deps.clock.now());
  const auditEventId = parseAuditEventId(
    deps.idGenerator?.generateAuditEventId?.() ?? generateUuidV7(),
  );

  return deps.analysisPort.reviewAnalysisAtomic({
    workspaceId: wsId,
    analysisId,
    expectedVersion: command.expectedVersion,
    decision: command.decision,
    reviewedByUserId: actorId,
    reviewedAt: now,
    reviewReason: sanitizedReason,
    auditEvent: {
      id: auditEventId,
      workspaceId: wsId,
      actorUserId: actorId,
      action: `analysis.${command.decision}`,
      resourceType: 'analysis',
      resourceId: analysisId,
      result: 'succeeded',
      changesJson: {
        status: command.decision,
        reason: sanitizedReason,
      },
    },
  });
}
