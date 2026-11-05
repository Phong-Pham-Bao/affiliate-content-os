import type { AuthConfig } from '@affiliate-content-os/config';
import type {
  AuthCryptoPort,
  LoginTransactionStorePort,
  OidcProtocolPort,
  ResolveVerifiedIdentityDependencies,
  SessionStorePort,
  UserDirectoryPort,
  WorkspaceSummaryPort,
} from '@affiliate-content-os/application';

export interface AuthDependencies {
  readonly config: AuthConfig;
  readonly appBaseUrl?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly generateId?: (() => string) | undefined;
  readonly oidcProtocolPort?: OidcProtocolPort | undefined;
  readonly loginTransactionStore?: LoginTransactionStorePort | undefined;
  readonly sessionStore?: SessionStorePort | undefined;
  readonly userDirectory?: UserDirectoryPort | undefined;
  readonly identityResolution?: ResolveVerifiedIdentityDependencies | undefined;
  readonly workspaceSummary?: WorkspaceSummaryPort | undefined;
  readonly crypto?: AuthCryptoPort | undefined;
}
