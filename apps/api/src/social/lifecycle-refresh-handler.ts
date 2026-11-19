import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refreshSocialAccount } from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { extractSocialIdempotencyKey } from './authorize-handler.js';
import { extractSocialAuditContext, validateSocialMutationOrigin } from './helpers.js';
import { serializeSocialAccount } from './serializers.js';
import type { SocialRouteDependencies } from './types.js';

export async function handleRefreshSocialAccount(
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
  const auditContext = extractSocialAuditContext(request);

  if (!deps.credentialProtector) {
    throw new Error('Credential protector is required for refreshing accounts');
  }

  const requestHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        accountId,
        action: 'refresh',
      }),
    )
    .digest();

  const routeKey = `POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/refresh`;
  const now = (deps.clock?.now() ?? new Date()).toISOString();

  const executeRefresh = async (claimedOp?: {
    readonly operationId: string;
    readonly leaseToken: string;
  }) => {
    const res = await refreshSocialAccount(
      {
        workspaceId,
        accountId,
        actorUserId: authContext.user.id,
        auditContext,
        operationId: claimedOp?.operationId,
      },
      {
        persistence: deps.socialPersistence,
        workspaceAuthorization: deps.workspaceAuthorization,
        protector: deps.credentialProtector!,
        adapters: deps.authAdapters,
        enabled: deps.socialConfig.enabled,
        socialKillSwitchActive: deps.socialConfig.socialKillSwitchActive,
        threadsRefreshKillSwitchActive: deps.socialConfig.threadsRefreshKillSwitchActive,
        appReviewStatus: deps.socialConfig.threadsAppReviewStatus,
        threadsHttpTimeoutMs: deps.socialConfig.threadsHttpTimeoutMs,
        clock: deps.clock ? deps.clock : { now: () => new Date() },
      },
    );
    return res.account;
  };

  let account;
  if (typeof deps.socialPersistence.executeMutationWithIdempotency === 'function') {
    const idempResult = await deps.socialPersistence.executeMutationWithIdempotency({
      workspaceId,
      accountId,
      actorUserId: authContext.user.id,
      idempotency: {
        idempotencyKey: rawKey,
        keyHash,
        requestHash,
        routeKey,
      },
      now,
      operationType: 'refresh',
      executeMutation: executeRefresh,
    });
    account = idempResult.account;
  } else {
    account = await executeRefresh();
  }

  const dto = serializeSocialAccount(account);
  return reply.status(200).type('application/json; charset=utf-8').send(dto);
}
