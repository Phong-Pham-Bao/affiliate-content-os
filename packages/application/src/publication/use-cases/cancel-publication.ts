import {
  parsePublicationId,
  parseUserId,
  parseWorkspaceId,
  type Publication,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../../authorize-workspace-action.js';
import { ValidationError } from '../../errors.js';
import type { WorkspaceAuthorizationPort } from '../../ports.js';
import type { PublicationIdempotencyParams, PublicationPersistencePort } from '../ports.js';

export interface CancelPublicationCommand {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly publicationId: string;
  readonly expectedVersion: number;
  readonly idempotency: PublicationIdempotencyParams;
}

export interface CancelPublicationDependencies {
  readonly persistence: PublicationPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export async function cancelPublication(
  command: CancelPublicationCommand,
  deps: CancelPublicationDependencies,
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

  return deps.persistence.cancelPublicationTransaction({
    workspaceId,
    actorUserId,
    publicationId,
    expectedVersion: command.expectedVersion,
    idempotency: command.idempotency,
  });
}
