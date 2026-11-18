import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  IdempotencyKeyReusedError,
  beginSocialAuthorization,
} from '@affiliate-content-os/application';
import { validateIdempotencyKey, type WorkspaceId } from '@affiliate-content-os/domain';
import { MalformedIdempotencyKeyError } from '../catalog/errors.js';
import { requireAuthenticatedSession } from '../auth/session-auth.js';
import { extractSocialAuditContext, validateSocialMutationOrigin } from './helpers.js';
import { serializeAuthorizeResponse } from './serializers.js';
import type { SocialRouteDependencies } from './types.js';

export function extractSocialIdempotencyKey(request: FastifyRequest): {
  rawKey: string;
  keyHash: Uint8Array;
} {
  const rawKey = request.headers['idempotency-key'];
  if (typeof rawKey !== 'string' || rawKey.trim() === '') {
    throw new MalformedIdempotencyKeyError();
  }
  try {
    const validKey = validateIdempotencyKey(rawKey);
    const keyHash = crypto.createHash('sha256').update(validKey).digest();
    return { rawKey: validKey, keyHash };
  } catch {
    throw new MalformedIdempotencyKeyError();
  }
}

export async function handleAuthorizeSocialConnection(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: SocialRouteDependencies,
): Promise<void> {
  const authContext = await requireAuthenticatedSession(request, reply, deps.auth);
  validateSocialMutationOrigin(request, deps);

  const { workspaceId, platform } = request.params as {
    readonly workspaceId: string;
    readonly platform: string;
  };

  const { keyHash } = extractSocialIdempotencyKey(request);

  const body = (request.body as { readonly returnTo?: string } | undefined) ?? {};
  const returnTo = typeof body.returnTo === 'string' ? body.returnTo : undefined;

  const routeKey = `POST /api/v1/workspaces/:workspaceId/social-connections/${platform}/authorize`;
  const requestHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        platform,
        returnTo: returnTo ?? null,
      }),
    )
    .digest();

  // Check idempotency cache if store is configured
  if (deps.idempotencyStore) {
    const cached = await deps.idempotencyStore.findIdempotencyRecord({
      principalId: authContext.user.id,
      routeKey,
      keyHash,
      workspaceId: workspaceId as WorkspaceId,
    });

    if (cached) {
      if (!Buffer.from(cached.requestHash).equals(requestHash)) {
        throw new IdempotencyKeyReusedError();
      }
      return reply
        .status(cached.statusCode)
        .type('application/json; charset=utf-8')
        .send(cached.responseJson);
    }
  }

  const appBaseUrl = deps.auth.appBaseUrl ?? 'http://127.0.0.1:3000';
  const redirectUri = `${appBaseUrl}/api/v1/social-connections/${platform}/callback`;

  const now = deps.clock ? deps.clock.now() : new Date();
  const ttlSeconds = deps.socialConfig.transactionTtlSeconds;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  const auditContext = extractSocialAuditContext(request);

  const result = await beginSocialAuthorization(
    {
      workspaceId,
      actorUserId: authContext.user.id,
      platform,
      redirectUri,
      returnTo,
    },
    {
      persistence: deps.socialPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      adapters: deps.authAdapters,
      enabled: deps.socialConfig.enabled,
      transactionTtlSeconds: ttlSeconds,
      idGenerator: {
        generate: () =>
          deps.idGenerator?.generateId ? deps.idGenerator.generateId() : crypto.randomUUID(),
      },
      clock: { now: () => now },
      auditContext,
    },
  );

  const responseDto = serializeAuthorizeResponse(result, expiresAt);

  return reply.status(200).type('application/json; charset=utf-8').send(responseDto);
}
