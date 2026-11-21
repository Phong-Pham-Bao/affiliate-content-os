import type { FastifyReply, FastifyRequest } from 'fastify';
import { getPublication, listPublications } from '@affiliate-content-os/application';
import type { PublicationStatus, SocialPlatform } from '@affiliate-content-os/domain';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { serializePublicationDetail, serializePublicationList } from './serializers.js';
import type { PublicationRouteDependencies } from './types.js';

export async function handleListPublications(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PublicationRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);

  const { workspaceId } = request.params as { readonly workspaceId: string };
  const query =
    (request.query as {
      readonly limit?: number | undefined;
      readonly cursor?: string | undefined;
      readonly status?: string | undefined;
      readonly socialAccountId?: string | undefined;
      readonly platform?: string | undefined;
    }) ?? {};

  const result = await listPublications(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      options: {
        limit: query.limit,
        cursor: query.cursor,
        status: query.status as PublicationStatus | undefined,
        socialAccountId: query.socialAccountId,
        platform: query.platform as SocialPlatform | undefined,
      },
    },
    {
      persistence: deps.publicationPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  const dto = serializePublicationList(result);
  return reply.status(200).type('application/json; charset=utf-8').send(dto);
}

export async function handleGetPublication(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PublicationRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);

  const { workspaceId, publicationId } = request.params as {
    readonly workspaceId: string;
    readonly publicationId: string;
  };

  const detail = await getPublication(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      publicationId,
    },
    {
      persistence: deps.publicationPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  const dto = serializePublicationDetail(detail);
  return reply.status(200).type('application/json; charset=utf-8').send(dto);
}
