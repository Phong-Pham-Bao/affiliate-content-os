export type {
  CreateAuthorizationUrlInput,
  CreateAuthorizationUrlResult,
  ExchangeCodeInput,
  ExchangeCodeResult,
  RefreshTokenInput,
  RefreshTokenResult,
  RevokeTokenResult,
  SocialAuthAdapter,
} from './ports-adapter.js';

export type {
  DecryptedSocialCredentials,
  EncryptedOAuthVerifier,
  EncryptedSocialCredentials,
  SocialCredentialProtectorPort,
} from './ports-crypto.js';

export type {
  ClaimSocialAccountForRefreshParams,
  ClaimedSocialAccountRefresh,
  CompleteSocialAccountRefreshParams,
  DisconnectSocialAccountParams,
  RecordFailedSocialAccountRefreshParams,
} from './ports-lifecycle-params.js';

export type {
  AuthorizeResponseData,
  ClaimOAuthTransactionParams,
  ClaimedOAuthTransaction,
  CompleteOAuthCallbackAtomicParams,
  CompleteOAuthCallbackAtomicResult,
  ConsumeCallbackResultParams,
  RecordFailedOAuthCallbackParams,
  SaveOAuthTransactionParams,
  SaveOAuthTransactionWithIdempotencyParams,
  SaveOAuthTransactionWithIdempotencyResult,
  SocialAuditContext,
  SocialPersistencePort,
} from './ports-persistence.js';
