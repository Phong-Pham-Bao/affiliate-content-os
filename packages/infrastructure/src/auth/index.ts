export {
  CryptoOperationError,
  fromCanonicalBase64Url,
  generateSecureRandomBytes,
  LoginTransactionSecretsProtector,
  sha256,
  toCanonicalBase64Url,
  type EncryptedLoginSecrets,
  type LoginSecretsPayload,
} from './crypto.js';

export {
  copyBytes,
  mapConsumedTransactionRow,
  mapSessionRow,
  mapWorkspaceSummaryRow,
  type ApplicationSessionRow,
  type ConsumedLoginTransactionRow,
  type WorkspaceSummaryRow,
} from './mappers.js';

export {
  createPostgresLoginTransactionAdapter,
  type OidcLoginTransactionInsert,
  type PostgresLoginTransactionAdapter,
} from './postgres-login-transaction-adapter.js';

export {
  createPostgresSessionAdapter,
  type ApplicationSessionInsert,
  type PostgresSessionAdapter,
} from './postgres-session-adapter.js';

export {
  createPostgresWorkspaceSummaryAdapter,
  type CurrentUserWorkspaceAccess,
  type PostgresWorkspaceSummaryAdapter,
} from './postgres-workspace-summary-adapter.js';

export { createAuthCryptoAdapter, InfrastructureAuthCryptoAdapter } from './crypto-adapter.js';

export {
  OidcProtocolAdapter,
  type OidcAdapterConfig,
  type OidcAdapterOptions,
} from './oidc-adapter.js';

export { discoverOidcAdapter } from './oidc-adapter-discovery.js';

export {
  classifyGrantError,
  classifyClientError,
  classifyResponseBodyError,
  defaultDiagnosticLogger,
  mapDiagnosticOutcome,
  type DiagnosticLogger,
  type OidcDiagnosticCategory,
  type OidcDiagnosticOutcome,
  type SafeDiagnosticEntry,
} from './oidc-grant-diagnostic.js';
