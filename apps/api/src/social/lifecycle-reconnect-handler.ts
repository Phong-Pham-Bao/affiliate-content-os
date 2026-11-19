import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { beginSocialReconnect } from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { extractSocialIdempotencyKey } from './authorize-handler.js';
import { extractSocialAuditContext, validateSocialMutationOrigin } from './helpers.js';
import type { SocialRouteDependencies } from './types.js';

export async function handleReconnectSocialAccount(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: SocialRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateSocialMutationOrigin(request, deps);

  const { workspaceId, accountId } = request.params as {
    readonly workspaceId: string;
    readonly accountId: string;
  };

  const { rawKey, keyHash } = extractSocialIdempotencyKey(request);

  const body = (request.body as { readonly returnTo?: string } | undefined) ?? {};
  const returnTo = typeof body.returnTo === 'string' ? body.returnTo : undefined;

  const requestHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        accountId,
        returnTo: returnTo ?? null,
        action: 'reconnect',
      }),
    )
    .digest();

  const appBaseUrl = deps.auth.appBaseUrl ?? 'http://127.0.0.1:3000';
  const redirectUri =
    deps.socialConfig.threadsRedirectUri ??
    `${appBaseUrl}/api/v1/social-connections/threads/callback`;
  const auditContext = extractSocialAuditContext(request);

  const result = await beginSocialReconnect(
    {
      workspaceId,
      accountId,
      actorUserId: authContext.user.id,
      redirectUri,
      returnTo,
      idempotencyKey: rawKey,
      keyHash,
      requestHash,
      auditContext,
    },
    {
      persistence: deps.socialPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      protector: deps.credentialProtector,
      adapters: deps.authAdapters,
      enabled: deps.socialConfig.enabled,
      socialKillSwitchActive: deps.socialConfig.socialKillSwitchActive,
      connectionKillSwitchActive: deps.socialConfig.threadsConnectionKillSwitchActive,
      transactionTtlSeconds: deps.socialConfig.transactionTtlSeconds,
      clock: deps.clock ? deps.clock : { now: () => new Date() },
      idGenerator: {
        generate: () =>
          deps.idGenerator?.generateId ? deps.idGenerator.generateId() : crypto.randomUUID(),
      },
    },
  );

  return reply.status(200).type('application/json; charset=utf-8').send({
    authorizationUrl: result.authorizationUrl,
    transactionId: result.transactionId,
    expiresAt: result.expiresAt,
  });
}
