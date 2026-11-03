import type { UserSnapshot } from '@affiliate-content-os/domain';
import type { UserDirectoryPort } from '../ports.js';
import type { AuthCryptoPort, SessionStorePort } from './ports.js';

export interface AuthenticateSessionCommand {
  readonly sessionCookie: unknown;
}

export interface AuthenticateSessionDependencies {
  readonly crypto: AuthCryptoPort;
  readonly sessionStore: SessionStorePort;
  readonly userDirectory?: UserDirectoryPort;
  readonly now: () => Date;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionRotationSeconds: number;
  readonly sessionRotationGraceSeconds: number;
  readonly sessionTouchIntervalSeconds: number;
}

export interface AuthenticatedSessionContext {
  readonly user: UserSnapshot;
  readonly session: {
    readonly id: string;
    readonly userId: string;
    readonly idleExpiresAt: string;
    readonly absoluteExpiresAt: string;
  };
  readonly rotatedToken: string | null;
}
