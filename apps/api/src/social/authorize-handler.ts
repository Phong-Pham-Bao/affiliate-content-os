import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { beginSocialAuthorization } from '@affiliate-content-os/application';
import { validateIdempotencyKey } from '@affiliate-content-os/domain';
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

  const { rawKey, keyHash } = extractSocialIdempotencyKey(request);

  const body = (request.body as { readonly returnTo?: string } | undefined) ?? {};
  const returnTo = typeof body.returnTo === 'string' ? body.returnTo : undefined;

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
      idempotencyKey: rawKey,
      keyHash,
      requestHash,
    },
    {
      persistence: deps.socialPersistence,
      workspaceAuthorization: deps.workspaceAuthorization,
      protector: deps.credentialProtector,
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

  const responseDto = serializeAuthorizeResponse(result, result.expiresAt ?? expiresAt);

  return reply.status(200).type('application/json; charset=utf-8').send(responseDto);
}
