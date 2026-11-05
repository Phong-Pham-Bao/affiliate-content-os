export {
  beginOidcLogin,
  validateReturnTo,
  type BeginOidcLoginCommand,
  type BeginOidcLoginDependencies,
  type BeginOidcLoginResult,
} from './begin-oidc-login.js';

export {
  completeOidcLogin,
  type CompleteOidcLoginCommand,
  type CompleteOidcLoginDependencies,
  type CompleteOidcLoginResult,
} from './complete-oidc-login.js';

export {
  authenticateApplicationSession,
  type AuthenticatedSessionContext,
  type AuthenticateSessionCommand,
  type AuthenticateSessionDependencies,
} from './authenticate-session.js';

export {
  getCurrentUser,
  type CurrentUserResponseDTO,
  type GetCurrentUserDependencies,
} from './get-current-user.js';

export {
  logoutApplicationSession,
  type LogoutSessionCommand,
  type LogoutSessionDependencies,
} from './logout-session.js';

export {
  AuthConfigurationUnavailableError,
  AuthPersistenceError,
  AuthRequestValidationError,
  AuthenticationRequiredError,
  OidcCallbackInvalidError,
  OidcProviderUnavailableError,
  type AuthPersistenceOperation,
  type AuthRequestValidationField,
} from './errors.js';

export type {
  ActiveWorkspaceSummariesDTO,
  AuthCryptoPort,
  ConsumedLoginTransactionDTO,
  EncryptedSecretsDTO,
  LoginSecretsPayloadDTO,
  LoginTransactionStorePort,
  OidcExchangeResult,
  OidcProtocolPort,
  SessionSnapshotDTO,
  SessionStorePort,
  VerifiedOidcClaimsDTO,
  WorkspaceSummaryItemDTO,
  WorkspaceSummaryPort,
} from './ports.js';
