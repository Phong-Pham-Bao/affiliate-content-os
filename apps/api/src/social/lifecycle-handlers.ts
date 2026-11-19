import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  beginSocialReconnect,
  disconnectSocialAccount,
  refreshSocialAccount,
  SocialAccountVersionMismatchError,
} from '@affiliate-content-os/application';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { extractSocialIdempotencyKey } from './authorize-handler.js';
import { extractSocialAuditContext, validateSocialMutationOrigin } from './helpers.js';
import { serializeSocialAccount } from './serializers.js';
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
  // Redirect URI callback route for social connections
  const redirectUri = `${appBaseUrl}/api/v1/social-connections/threads/callback`;
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

  extractSocialIdempotencyKey(request);
  const auditContext = extractSocialAuditContext(request);

  if (!deps.credentialProtector) {
    throw new Error('Credential protector is required for refreshing accounts');
  }

  const result = await refreshSocialAccount(
    {
      workspaceId,
      accountId,
      actorUserId: authContext.user.id,
      auditContext,
    },
    {
      persistence: deps.socialPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      protector: deps.credentialProtector,
      adapters: deps.authAdapters,
      enabled: deps.socialConfig.enabled,
      socialKillSwitchActive: deps.socialConfig.socialKillSwitchActive,
      threadsRefreshKillSwitchActive: deps.socialConfig.threadsRefreshKillSwitchActive,
      appReviewStatus: deps.socialConfig.threadsAppReviewStatus,
      clock: deps.clock ? deps.clock : { now: () => new Date() },
    },
  );

  const dto = serializeSocialAccount(result.account);
  return reply.status(200).type('application/json; charset=utf-8').send(dto);
}

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

  extractSocialIdempotencyKey(request);

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

  const result = await disconnectSocialAccount(
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
      adapters: deps.authAdapters,
      clock: deps.clock ? deps.clock : { now: () => new Date() },
    },
  );

  const dto = serializeSocialAccount(result.account);
  return reply.status(200).type('application/json; charset=utf-8').send(dto);
}
