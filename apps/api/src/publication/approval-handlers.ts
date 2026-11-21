import type { FastifyReply, FastifyRequest } from 'fastify';
import { createPublicationApproval } from '@affiliate-content-os/application';
import type { ConsentType } from '@affiliate-content-os/domain';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import {
  computeCreatePublicationApprovalRequestHash,
  extractPublicationIdempotencyKey,
  validatePublicationMutationOrigin,
} from './helpers.js';
import { serializePublicationApprovalSnapshot } from './serializers.js';
import type { PublicationRouteDependencies } from './types.js';

export async function handleCreatePublicationApproval(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PublicationRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validatePublicationMutationOrigin(request, deps);

  const { workspaceId } = request.params as { readonly workspaceId: string };
  const { rawKey, keyHash } = extractPublicationIdempotencyKey(request);

  const body = request.body as {
    readonly contentApprovalId: string;
    readonly socialAccountId: string;
    readonly videoNumber: number;
    readonly platformSettings: Record<string, unknown>;
    readonly previewHashHex?: string | undefined;
    readonly consent: {
      readonly consentType: ConsentType;
      readonly policyVersion: string;
    };
  };

  const routeKey = 'POST /api/v1/workspaces/:workspaceId/publication-approvals';
  const requestHash = computeCreatePublicationApprovalRequestHash({
    workspaceId,
    contentApprovalId: body.contentApprovalId,
    socialAccountId: body.socialAccountId,
    videoNumber: body.videoNumber,
    platformSettings: body.platformSettings,
    previewHashHex: body.previewHashHex,
    consent: body.consent,
  });

  const snapshot = await createPublicationApproval(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      contentApprovalId: body.contentApprovalId,
      socialAccountId: body.socialAccountId,
      videoNumber: body.videoNumber,
      platformSettings: body.platformSettings,
      previewHashHex: body.previewHashHex,
      consent: body.consent,
      idempotency: {
        rawKey,
        keyHash,
        requestHash,
        routeKey,
      },
    },
    {
      persistence: deps.publicationPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  const dto = serializePublicationApprovalSnapshot(snapshot);
  return reply.status(201).type('application/json; charset=utf-8').send(dto);
}
