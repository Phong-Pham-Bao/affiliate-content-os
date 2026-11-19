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
  ClaimSocialAccountForRefreshParams,
  ClaimedSocialAccountRefresh,
  CompleteSocialAccountRefreshParams,
  DisconnectSocialAccountParams,
  RecordFailedSocialAccountRefreshParams,
  SocialAuditContext,
} from './ports-lifecycle-params.js';

export type { SocialAuditContext };

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
  claimSocialAccountForRefresh(
    params: ClaimSocialAccountForRefreshParams,
  ): Promise<ClaimedSocialAccountRefresh | null>;
  completeSocialAccountRefreshAtomic(
    params: CompleteSocialAccountRefreshParams,
  ): Promise<SocialAccountSnapshot>;
  recordFailedSocialAccountRefreshAtomic(
    params: RecordFailedSocialAccountRefreshParams,
  ): Promise<SocialAccountSnapshot>;
  disconnectSocialAccountAtomic(
    params: DisconnectSocialAccountParams,
  ): Promise<SocialAccountSnapshot>;
}
