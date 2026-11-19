import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  completeSocialCallback,
  SocialAuthNotConfiguredError,
} from '@affiliate-content-os/application';
import { extractSocialAuditContext, validateCallbackQueryParams } from './helpers.js';
import type { SocialRouteDependencies } from './types.js';

export async function handleSocialCallback(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: SocialRouteDependencies,
): Promise<void> {
  if (!deps.credentialProtector || !deps.socialConfig.enabled) {
    throw new SocialAuthNotConfiguredError();
  }

  const { platform } = request.params as { readonly platform: string };

  const { state, code, error, errorDescription } = validateCallbackQueryParams(request);

  const auditContext = extractSocialAuditContext(request);
  const now = deps.clock ? deps.clock.now() : new Date();

  const result = await completeSocialCallback(
    {
      platform,
      state,
      code,
      error,
      errorDescription,
    },
    {
      persistence: deps.socialPersistence,
      protector: deps.credentialProtector,
      adapters: deps.authAdapters,
      enabled: deps.socialConfig.enabled,
      callbackResultTtlSeconds: deps.socialConfig.callbackResultTtlSeconds,
      appReviewStatus: deps.socialConfig.threadsAppReviewStatus,
      socialKillSwitchActive: deps.socialConfig.socialKillSwitchActive,
      connectionKillSwitchActive: deps.socialConfig.threadsConnectionKillSwitchActive,
      clock: { now: () => now },
      auditContext,
    },
  );

  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('Referrer-Policy', 'no-referrer');

  return reply.redirect(result.redirectUrl, 302);
}
