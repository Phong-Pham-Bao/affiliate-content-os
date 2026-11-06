import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthConfigurationUnavailableError,
  authenticateApplicationSession,
  type AuthenticatedSessionContext,
} from '@affiliate-content-os/application';
import { COOKIE_SESSION } from './constants.js';
import { clearSessionCookie, setSessionCookie } from './cookies.js';
import type { AuthDependencies } from './types.js';

export async function requireAuthenticatedSession(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AuthDependencies,
): Promise<AuthenticatedSessionContext> {
  if (!deps.config.enabled || !deps.sessionStore || !deps.userDirectory || !deps.crypto) {
    throw new AuthConfigurationUnavailableError();
  }

  const sessionCookie = request.cookies[COOKIE_SESSION];
  let authContext: AuthenticatedSessionContext;
  try {
    authContext = await authenticateApplicationSession(
      { sessionCookie },
      {
        crypto: deps.crypto,
        sessionStore: deps.sessionStore,
        now: deps.now ?? (() => new Date()),
        sessionIdleTtlSeconds: deps.config.sessionIdleTtlSeconds,
        sessionRotationSeconds: deps.config.sessionRotationSeconds,
        sessionRotationGraceSeconds: deps.config.sessionRotationGraceSeconds,
        sessionTouchIntervalSeconds: deps.config.sessionTouchIntervalSeconds,
      },
    );
  } catch (err) {
    clearSessionCookie(reply, deps.config);
    throw err;
  }

  const currentNow = deps.now ? deps.now() : new Date();
  if (authContext.rotatedToken !== null) {
    setSessionCookie(
      reply,
      authContext.rotatedToken,
      new Date(authContext.session.absoluteExpiresAt),
      deps.config,
      currentNow,
    );
  }

  return authContext;
}
