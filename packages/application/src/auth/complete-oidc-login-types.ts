import type { ResolveVerifiedIdentityDependencies } from '../resolve-verified-identity.js';
import type {
  AuthCryptoPort,
  LoginTransactionStorePort,
  OidcProtocolPort,
  SessionStorePort,
} from './ports.js';

export interface CompleteOidcLoginCommand {
  readonly query: unknown;
  readonly transactionCookie: unknown;
}

export interface CompleteOidcLoginDependencies {
  readonly crypto: AuthCryptoPort;
  readonly transactionStore: LoginTransactionStorePort;
  readonly sessionStore: SessionStorePort;
  readonly oidc: OidcProtocolPort;
  readonly identityResolution: ResolveVerifiedIdentityDependencies;
  readonly generateId: () => string;
  readonly now: () => Date;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
}

export interface CompleteOidcLoginResult {
  readonly sessionToken: string;
  readonly returnTo: string;
  readonly absoluteExpiresAt: string;
}
