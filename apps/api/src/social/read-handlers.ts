import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSocialCallbackResult, listSocialAccounts } from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { serializeCallbackResult, serializeSocialAccountList } from './serializers.js';
import type { SocialRouteDependencies } from './types.js';

export async function handleListSocialAccounts(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: SocialRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId } = request.params as { readonly workspaceId: string };

  const accounts = await listSocialAccounts(
    {
      workspaceId,
      actorUserId: authContext.user.id,
    },
    {
      persistence: deps.socialPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
    },
  );

  return reply
    .status(200)
    .type('application/json; charset=utf-8')
    .send(serializeSocialAccountList(accounts));
}

export async function handleGetCallbackResult(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: SocialRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  const { workspaceId, resultKey } = request.params as {
    readonly workspaceId: string;
    readonly resultKey: string;
  };

  const now = deps.clock ? deps.clock.now() : new Date();

  const result = await getSocialCallbackResult(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      resultKey,
    },
    {
      persistence: deps.socialPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      enabled: deps.socialConfig.enabled,
      clock: { now: () => now },
    },
  );

  return reply
    .status(200)
    .type('application/json; charset=utf-8')
    .send(serializeCallbackResult(result));
}
