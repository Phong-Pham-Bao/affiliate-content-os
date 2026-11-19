import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  disconnectSocialAccount,
  SocialAccountVersionMismatchError,
} from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { extractSocialIdempotencyKey } from './authorize-handler.js';
import { extractSocialAuditContext, validateSocialMutationOrigin } from './helpers.js';
import { serializeSocialAccount } from './serializers.js';
import type { SocialRouteDependencies } from './types.js';

export async function handleDisconnectSocialAccount(
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

  // Extract expectedVersion from If-Match header or JSON body
  let expectedVersion: number | undefined;
  const ifMatch = request.headers['if-match'];
  if (typeof ifMatch === 'string' && ifMatch.trim().length > 0) {
    const parsed = Number(ifMatch.replace(/["']/g, '').trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      expectedVersion = parsed;
    }
  }

  if (expectedVersion === undefined) {
    const body = request.body as { readonly expectedVersion?: unknown } | undefined;
    if (
      body &&
      typeof body.expectedVersion === 'number' &&
      Number.isInteger(body.expectedVersion)
    ) {
      expectedVersion = body.expectedVersion;
    }
  }

  if (expectedVersion === undefined) {
    throw new SocialAccountVersionMismatchError(
      'Disconnect requires an exact current account version in If-Match header or body.',
    );
  }

  const auditContext = extractSocialAuditContext(request);

  const requestHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        accountId,
        expectedVersion,
        action: 'disconnect',
      }),
    )
    .digest();

  const routeKey = `DELETE /api/v1/workspaces/:workspaceId/social-accounts/:accountId`;
  const now = (deps.clock?.now() ?? new Date()).toISOString();

  const executeDisconnect = async () => {
    const res = await disconnectSocialAccount(
      {
        workspaceId,
        accountId,
        actorUserId: authContext.user.id,
        expectedVersion,
        auditContext,
      },
      {
        persistence: deps.socialPersistence,
        workspaceAuthorization: deps.workspaceAuthorization,
        protector: deps.credentialProtector,
        adapters: deps.authAdapters,
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
      executeMutation: executeDisconnect,
    });
    account = idempResult.account;
  } else {
    account = await executeDisconnect();
  }

  const dto = serializeSocialAccount(account);
  return reply.status(200).type('application/json; charset=utf-8').send(dto);
}
