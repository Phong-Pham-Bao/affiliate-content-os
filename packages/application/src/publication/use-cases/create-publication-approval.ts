import {
  parseSocialAccountId,
  parseUserId,
  parseWorkspaceId,
  type ConsentType,
  type PublicationApprovalSnapshot,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../../authorize-workspace-action.js';
import { ValidationError } from '../../errors.js';
import type { WorkspaceAuthorizationPort } from '../../ports.js';
import type { PublicationIdempotencyParams, PublicationPersistencePort } from '../ports.js';

export interface CreatePublicationApprovalCommand {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly contentApprovalId: string;
  readonly socialAccountId: string;
  readonly videoNumber?: number | undefined;
  readonly platformSettings?: Record<string, unknown> | undefined;
  readonly previewHashHex?: string | undefined;
  readonly consent: {
    readonly consentType: ConsentType;
    readonly policyVersion: string;
  };
  readonly idempotency: PublicationIdempotencyParams;
}

export interface CreatePublicationApprovalDependencies {
  readonly persistence: PublicationPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
}

export async function createPublicationApproval(
  command: CreatePublicationApprovalCommand,
  deps: CreatePublicationApprovalDependencies,
): Promise<PublicationApprovalSnapshot> {
  const workspaceId = parseWorkspaceId(command.workspaceId);
  const actorUserId = parseUserId(command.actorUserId);
  const socialAccountId = parseSocialAccountId(command.socialAccountId);

  // Human editor/owner required: verify both content.approve and publications.manage
  await authorizeWorkspaceAction(
    {
      workspaceId,
      userId: actorUserId,
      capability: 'content.approve',
    },
    { authorization: deps.workspaceAuthorization },
  );

  await authorizeWorkspaceAction(
    {
      workspaceId,
      userId: actorUserId,
      capability: 'publications.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const videoNumber = command.videoNumber ?? 1;
  if (!Number.isInteger(videoNumber) || videoNumber < 1 || videoNumber > 5) {
    throw new ValidationError('videoNumber must be an integer between 1 and 5', 'videoNumber');
  }

  if (command.consent.consentType !== 'human_publisher') {
    throw new ValidationError("consentType must be 'human_publisher'", 'consentType');
  }

  if (!command.consent.policyVersion || command.consent.policyVersion.trim() === '') {
    throw new ValidationError('policyVersion is required', 'policyVersion');
  }

  return deps.persistence.createApprovalSnapshotTransaction({
    workspaceId,
    actorUserId,
    contentApprovalId: command.contentApprovalId,
    socialAccountId,
    videoNumber,
    platformSettings: command.platformSettings ?? {},
    previewHashHex: command.previewHashHex,
    consent: command.consent,
    idempotency: command.idempotency,
  });
}
