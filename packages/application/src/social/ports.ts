export type {
  CreateAuthorizationUrlInput,
  CreateAuthorizationUrlResult,
  ExchangeCodeInput,
  ExchangeCodeResult,
  InspectAccountInput,
  InspectAccountResult,
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
  ClaimNextDueSocialAccountParams,
  ClaimSocialAccountForRefreshParams,
  ClaimedSocialAccountRefresh,
  CompleteSocialAccountRefreshParams,
  DisconnectSocialAccountParams,
  RecordFailedSocialAccountRefreshParams,
  ReleaseSocialAccountRefreshLeaseParams,
  SocialIdempotencyInput,
  UpdateExternalRevocationResultParams,
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
