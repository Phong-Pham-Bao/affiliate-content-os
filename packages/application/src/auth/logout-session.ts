import type { AuthCryptoPort, SessionStorePort } from './ports.js';

export interface LogoutSessionCommand {
  readonly sessionCookie?: unknown;
}

export interface LogoutSessionDependencies {
  readonly crypto: AuthCryptoPort;
  readonly sessionStore: SessionStorePort;
  readonly now: () => Date;
}

export async function logoutApplicationSession(
  command: LogoutSessionCommand,
  deps: LogoutSessionDependencies,
): Promise<void> {
  const cookie = command?.sessionCookie;
  if (
    typeof cookie === 'string' &&
    cookie.length === 43 &&
    !cookie.includes('=') &&
    /^[A-Za-z0-9_-]{43}$/.test(cookie)
  ) {
    const tokenHash = deps.crypto.hashToken(cookie);
    await deps.sessionStore.revokeMatchingSessionsByTokenHash({
      tokenHash,
      revokedAt: deps.now().toISOString(),
      reason: 'logout',
    });
  }
}
