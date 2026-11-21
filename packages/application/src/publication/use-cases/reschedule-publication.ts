import {
  parsePublicationId,
  parseUserId,
  parseWorkspaceId,
  validateScheduleTriple,
  type Publication,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../../authorize-workspace-action.js';
import { ValidationError } from '../../errors.js';
import type { WorkspaceAuthorizationPort } from '../../ports.js';
import type { PublicationIdempotencyParams, PublicationPersistencePort } from '../ports.js';

export interface ReschedulePublicationCommand {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly publicationId: string;
  readonly expectedVersion: number;
  readonly scheduledAtUtc: string;
  readonly originalLocalTime: string;
  readonly timezone: string;
  readonly idempotency: PublicationIdempotencyParams;
}

export interface ReschedulePublicationDependencies {
  readonly persistence: PublicationPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly now?: (() => Date) | undefined;
  readonly minLeadTimeSeconds?: number | undefined;
  readonly maxHorizonDays?: number | undefined;
}

export async function reschedulePublication(
  command: ReschedulePublicationCommand,
  deps: ReschedulePublicationDependencies,
): Promise<Publication> {
  const workspaceId = parseWorkspaceId(command.workspaceId);
  const actorUserId = parseUserId(command.actorUserId);
  const publicationId = parsePublicationId(command.publicationId);

  await authorizeWorkspaceAction(
    {
      workspaceId,
      userId: actorUserId,
      capability: 'publications.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
    throw new ValidationError('expectedVersion must be a positive integer', 'expectedVersion');
  }

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

  return deps.persistence.reschedulePublicationTransaction({
    workspaceId,
    actorUserId,
    publicationId,
    expectedVersion: command.expectedVersion,
    schedule,
    idempotency: command.idempotency,
  });
}
