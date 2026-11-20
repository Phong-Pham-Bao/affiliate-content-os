import type {
  OAuthCallbackResultSnapshot,
  OAuthExchangeStage,
  OAuthTransactionSnapshot,
  SocialAccountEnvironment,
  SocialAccountSnapshot,
  SocialAccountStatus,
  SocialAccountStatusReason,
  SocialPlatform,
} from '@affiliate-content-os/domain';
import type { EncryptedOAuthVerifier, EncryptedSocialCredentials } from './ports-crypto.js';
import type {
  ClaimNextDueSocialAccountParams,
  ClaimSocialAccountForRefreshParams,
  ClaimedSocialAccountRefresh,
  CompleteSocialAccountRefreshParams,
  DisconnectSocialAccountParams,
  RecordFailedSocialAccountRefreshParams,
  ReleaseSocialAccountRefreshLeaseParams,
  SocialAuditContext,
  SocialIdempotencyInput,
  UpdateExternalRevocationResultParams,
} from './ports-lifecycle-params.js';

export type { SocialAuditContext, SocialIdempotencyInput };

export interface AuthorizeResponseData {
  readonly authorizationUrl: string;
  readonly transactionId: string;
  readonly expiresAt: string;
}

export interface SaveOAuthTransactionParams {
  readonly id: string;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly initiatedByUserId: string;
  readonly stateHash: Uint8Array;
  readonly pkceVerifierCiphertext?: Uint8Array | null | undefined;
  readonly pkceVerifierIv?: Uint8Array | null | undefined;
  readonly pkceVerifierAuthTag?: Uint8Array | null | undefined;
  readonly encryptionKeyVersion?: string | null | undefined;
  readonly redirectUri: string;
  readonly returnTo: string;
  readonly requestedScopes: readonly string[];
  readonly reconnectAccountId?: string | null | undefined;
  readonly expectedProviderAccountId?: string | null | undefined;
  readonly exchangeStage?: OAuthExchangeStage | undefined;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface SaveOAuthTransactionWithIdempotencyParams extends SaveOAuthTransactionParams {
  readonly idempotencyKey: string;
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
  readonly routeKey: string;
  readonly responseData: AuthorizeResponseData;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface SaveOAuthTransactionWithIdempotencyResult {
  readonly replayed: boolean;
  readonly response: AuthorizeResponseData;
}

export interface ClaimOAuthTransactionParams {
  readonly stateHash: Uint8Array;
  readonly platform: SocialPlatform;
  readonly now: string;
  readonly claimTtlSeconds: number;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface ClaimedOAuthTransaction {
  readonly id: string;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly initiatedByUserId: string;
  readonly redirectUri: string;
  readonly returnTo: string;
  readonly requestedScopes: readonly string[];
  readonly reconnectAccountId?: string | null | undefined;
  readonly expectedProviderAccountId?: string | null | undefined;
  readonly encryptedVerifier?: EncryptedOAuthVerifier | undefined;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly claimedAt: string;
  readonly version: number;
}

export interface CompleteOAuthCallbackAtomicParams {
  readonly transactionId: string;
  readonly stateHash: Uint8Array;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly actorUserId: string;
  readonly providerAccountId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly grantedScopes: readonly string[];
  readonly capabilities: Record<string, boolean>;
  readonly capabilitiesCheckedAt: string;
  readonly tokenExpiresAt: string | null;
  readonly environment: SocialAccountEnvironment;
  readonly reconnectAccountId?: string | null | undefined;
  readonly exchangeStage?: OAuthExchangeStage | undefined;
  readonly statusReason?: SocialAccountStatusReason | null | undefined;
  readonly derivedStatus?: SocialAccountStatus | undefined;
  readonly callbackStatus?: 'success' | 'partial' | undefined;
  readonly callbackErrorCode?: string | null | undefined;
  readonly callbackErrorDescription?: string | null | undefined;
  readonly encryptCredentials: (accountId: string) => EncryptedSocialCredentials;
  readonly resultKeyHash: Uint8Array;
  readonly resultExpiresAt: string;
  readonly now: string;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface CompleteOAuthCallbackAtomicResult {
  readonly account: SocialAccountSnapshot;
  readonly callbackResult: OAuthCallbackResultSnapshot;
}

export interface RecordFailedOAuthCallbackParams {
  readonly transactionId: string;
  readonly stateHash: Uint8Array;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly actorUserId: string;
  readonly errorCode: string;
  readonly errorDescription: string;
  readonly resultKeyHash: Uint8Array;
  readonly resultExpiresAt: string;
  readonly now: string;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface ConsumeCallbackResultParams {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly resultKeyHash: Uint8Array;
  readonly now: string;
}

export interface SocialMutationCompletedResult {
  readonly status: 'completed';
  readonly replayed: boolean;
  readonly account: SocialAccountSnapshot;
}

export interface SocialMutationInProgressResult {
  readonly status: 'in_progress';
  readonly retryAfterSeconds: number;
}

export type SocialMutationIdempotencyResult =
  SocialMutationCompletedResult | SocialMutationInProgressResult;

export interface ClaimedRevocationJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly socialAccountId: string;
  readonly platform: SocialPlatform;
  readonly encryptedToken: Uint8Array;
  readonly tokenIv: Uint8Array;
  readonly tokenAuthTag: Uint8Array;
  readonly encryptionKeyVersion: string;
  readonly status: 'pending' | 'in_progress';
  readonly phase: 'claimed' | 'provider_attempt_started' | 'terminal';
  readonly leaseToken: string;
  readonly attemptCount: number;
}

export interface SocialPersistencePort {
  saveOAuthTransaction(params: SaveOAuthTransactionParams): Promise<OAuthTransactionSnapshot>;
  saveOAuthTransactionWithIdempotency(
    params: SaveOAuthTransactionWithIdempotencyParams,
  ): Promise<SaveOAuthTransactionWithIdempotencyResult>;
  claimOAuthTransaction(params: ClaimOAuthTransactionParams): Promise<ClaimedOAuthTransaction>;
  findPendingTransactionByStateHash(
    stateHash: Uint8Array,
  ): Promise<OAuthTransactionSnapshot | null>;
  completeOAuthCallbackAtomic(
    params: CompleteOAuthCallbackAtomicParams,
  ): Promise<CompleteOAuthCallbackAtomicResult>;
  recordFailedOAuthCallbackAtomic(
    params: RecordFailedOAuthCallbackParams,
  ): Promise<OAuthCallbackResultSnapshot>;
  consumeCallbackResult(
    params: ConsumeCallbackResultParams,
  ): Promise<OAuthCallbackResultSnapshot | null>;
  listSocialAccounts(params: {
    readonly workspaceId: string;
  }): Promise<readonly SocialAccountSnapshot[]>;
  findSocialAccountById(params: {
    readonly workspaceId: string;
    readonly accountId: string;
  }): Promise<SocialAccountSnapshot | null>;
  findSocialAccountForUpdate(params: {
    readonly workspaceId: string;
    readonly accountId: string;
  }): Promise<SocialAccountSnapshot | null>;
  findEncryptedCredentials(params: {
    readonly workspaceId: string;
    readonly accountId: string;
  }): Promise<EncryptedSocialCredentials | null>;
  claimSocialAccountForRefresh(
    params: ClaimSocialAccountForRefreshParams,
  ): Promise<ClaimedSocialAccountRefresh | null>;
  claimNextDueSocialAccountForRefresh(
    params: ClaimNextDueSocialAccountParams,
  ): Promise<ClaimedSocialAccountRefresh | null>;
  completeSocialAccountRefreshAtomic(
    params: CompleteSocialAccountRefreshParams,
  ): Promise<SocialAccountSnapshot>;
  recordFailedSocialAccountRefreshAtomic(
    params: RecordFailedSocialAccountRefreshParams,
  ): Promise<SocialAccountSnapshot>;
  releaseSocialAccountRefreshLeaseAtomic(
    params: ReleaseSocialAccountRefreshLeaseParams,
  ): Promise<void>;
  disconnectSocialAccountAtomic(
    params: DisconnectSocialAccountParams,
  ): Promise<SocialAccountSnapshot>;
  updateExternalRevocationResultAtomic?(
    params: UpdateExternalRevocationResultParams,
  ): Promise<void>;
  markOperationAttemptStarted?(params: {
    readonly operationId: string;
    readonly leaseToken: string;
  }): Promise<void>;
  claimNextDueSocialAccountRevocationJob?(params: {
    readonly now: string;
    readonly workerId: string;
    readonly leaseDurationSeconds: number;
    readonly claimToken: string;
  }): Promise<ClaimedRevocationJob | null>;
  markSocialAccountRevocationAttemptStarted?(params: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly now: string;
  }): Promise<void>;
  completeSocialAccountRevocationJobAtomic?(params: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly workspaceId: string;
    readonly accountId: string;
    readonly now: string;
  }): Promise<void>;
  failSocialAccountRevocationJobAtomic?(params: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly workspaceId: string;
    readonly accountId: string;
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly now: string;
  }): Promise<void>;
  executeMutationWithIdempotency?(params: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly actorUserId: string;
    readonly idempotency: SocialIdempotencyInput;
    readonly now?: string | undefined;
    readonly leaseDurationSeconds?: number | undefined;
    readonly operationType?: 'refresh' | 'disconnect' | undefined;
    readonly executeMutation: (claimedOp?: {
      readonly operationId: string;
      readonly leaseToken: string;
    }) => Promise<SocialAccountSnapshot>;
  }): Promise<SocialMutationIdempotencyResult>;
}
