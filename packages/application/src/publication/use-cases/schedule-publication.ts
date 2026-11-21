import {
  parsePublicationApprovalSnapshotId,
  parseUserId,
  parseWorkspaceId,
  validateScheduleTriple,
  type Publication,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../../ports.js';
import type { PublicationIdempotencyParams, PublicationPersistencePort } from '../ports.js';

export interface SchedulePublicationCommand {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly approvalSnapshotId: string;
  readonly scheduledAtUtc: string;
  readonly originalLocalTime: string;
  readonly timezone: string;
  readonly idempotency: PublicationIdempotencyParams;
}

export interface SchedulePublicationDependencies {
  readonly persistence: PublicationPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly now?: (() => Date) | undefined;
  readonly minLeadTimeSeconds?: number | undefined;
  readonly maxHorizonDays?: number | undefined;
}

export async function schedulePublication(
  command: SchedulePublicationCommand,
  deps: SchedulePublicationDependencies,
): Promise<Publication> {
  const workspaceId = parseWorkspaceId(command.workspaceId);
  const actorUserId = parseUserId(command.actorUserId);
  const approvalSnapshotId = parsePublicationApprovalSnapshotId(command.approvalSnapshotId);

  await authorizeWorkspaceAction(
    {
      workspaceId,
      userId: actorUserId,
      capability: 'publications.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const schedule = validateScheduleTriple(
    {
      scheduledAtUtc: command.scheduledAtUtc,
      originalLocalTime: command.originalLocalTime,
      timezone: command.timezone,
    },
    {
      now: deps.now ? deps.now() : new Date(),
      minLeadTimeSeconds: deps.minLeadTimeSeconds,
      maxHorizonDays: deps.maxHorizonDays,
    },
  );

  return deps.persistence.createPublicationScheduleTransaction({
    workspaceId,
    actorUserId,
    approvalSnapshotId,
    schedule,
    idempotency: command.idempotency,
  });
}
