export {
  beginSocialAuthorization,
  type BeginSocialAuthorizationCommand,
  type BeginSocialAuthorizationDependencies,
  type BeginSocialAuthorizationResult,
} from './begin-social-authorization.js';

export {
  completeSocialCallback,
  type CompleteSocialCallbackCommand,
  type CompleteSocialCallbackDependencies,
  type CompleteSocialCallbackResult,
} from './complete-social-callback.js';

export {
  getSocialCallbackResult,
  type GetSocialCallbackResultDependencies,
  type GetSocialCallbackResultQuery,
  type SafeCallbackResultDTO,
} from './get-social-callback-result.js';

export {
  listSocialAccounts,
  type ListSocialAccountsDependencies,
  type ListSocialAccountsQuery,
  type SafeSocialAccountDTO,
} from './list-social-accounts.js';

export {
  CallbackResultForbiddenError,
  CallbackResultGoneError,
  CallbackResultNotFoundError,
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
  SocialAuthExchangeError,
  SocialAuthNotConfiguredError,
  SocialAuthRateLimitError,
  SocialCredentialEncryptionError,
  SocialPlatformUnsupportedError,
} from './errors.js';

export {
  type AuthorizeResponseData,
  type ClaimOAuthTransactionParams,
  type ClaimedOAuthTransaction,
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
  type ConsumeCallbackResultParams,
  type CreateAuthorizationUrlInput,
  type CreateAuthorizationUrlResult,
  type DecryptedSocialCredentials,
  type EncryptedOAuthVerifier,
  type EncryptedSocialCredentials,
  type ExchangeCodeInput,
  type ExchangeCodeResult,
  type RecordFailedOAuthCallbackParams,
  type SaveOAuthTransactionParams,
  type SaveOAuthTransactionWithIdempotencyParams,
  type SaveOAuthTransactionWithIdempotencyResult,
  type SocialAuditContext,
  type SocialAuthAdapter,
  type SocialCredentialProtectorPort,
  type SocialPersistencePort,
} from './ports.js';
