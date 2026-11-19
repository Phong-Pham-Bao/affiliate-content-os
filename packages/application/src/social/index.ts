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
  beginSocialReconnect,
  type BeginSocialReconnectCommand,
  type BeginSocialReconnectDependencies,
  type BeginSocialReconnectResult,
} from './begin-social-reconnect.js';

export {
  refreshSocialAccount,
  type RefreshSocialAccountCommand,
  type RefreshSocialAccountDependencies,
  type RefreshSocialAccountResult,
} from './refresh-social-account.js';

export {
  disconnectSocialAccount,
  type DisconnectSocialAccountCommand,
  type DisconnectSocialAccountDependencies,
  type DisconnectSocialAccountResult,
} from './disconnect-social-account.js';

export {
  maintainDueSocialAccounts,
  type MaintainDueSocialAccountsCommand,
  type MaintainDueSocialAccountsDependencies,
  type MaintainDueSocialAccountsResult,
} from './maintain-social-accounts.js';

export {
  CallbackResultForbiddenError,
  CallbackResultGoneError,
  CallbackResultNotFoundError,
  OAuthCallbackInvalidError,
  OAuthTransactionExpiredError,
  OAuthTransactionNotFoundError,
  OAuthTransactionReplayedError,
  SocialAccountDisconnectedError,
  SocialAccountMismatchError,
  SocialAccountNotFoundError,
  SocialAccountVersionMismatchError,
  SocialAuthExchangeError,
  SocialAuthNotConfiguredError,
  SocialAuthOutcomeUnknownError,
  SocialAuthRateLimitError,
  SocialAuthTerminalError,
  SocialCredentialEncryptionError,
  SocialKillSwitchActiveError,
  SocialPlatformUnsupportedError,
} from './errors.js';

export {
  type AuthorizeResponseData,
  type ClaimNextDueSocialAccountParams,
  type ClaimOAuthTransactionParams,
  type ClaimSocialAccountForRefreshParams,
  type ClaimedOAuthTransaction,
  type ClaimedSocialAccountRefresh,
  type CompleteOAuthCallbackAtomicParams,
  type CompleteOAuthCallbackAtomicResult,
  type CompleteSocialAccountRefreshParams,
  type ConsumeCallbackResultParams,
  type CreateAuthorizationUrlInput,
  type CreateAuthorizationUrlResult,
  type DecryptedSocialCredentials,
  type DisconnectSocialAccountParams,
  type EncryptedOAuthVerifier,
  type EncryptedSocialCredentials,
  type ExchangeCodeInput,
  type ExchangeCodeResult,
  type RecordFailedOAuthCallbackParams,
  type RecordFailedSocialAccountRefreshParams,
  type RefreshTokenInput,
  type RefreshTokenResult,
  type ReleaseSocialAccountRefreshLeaseParams,
  type RevokeTokenResult,
  type SaveOAuthTransactionParams,
  type SaveOAuthTransactionWithIdempotencyParams,
  type SaveOAuthTransactionWithIdempotencyResult,
  type SocialAuditContext,
  type SocialAuthAdapter,
  type SocialCredentialProtectorPort,
  type SocialIdempotencyInput,
  type SocialPersistencePort,
} from './ports.js';
