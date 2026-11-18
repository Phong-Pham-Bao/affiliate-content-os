import type {
  OAuthCallbackResultSnapshot,
  OAuthTransactionSnapshot,
  SocialAccountEnvironment,
  SocialAccountSnapshot,
  SocialPlatform,
} from '@affiliate-content-os/domain';

export interface CreateAuthorizationUrlInput {
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly state: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

export interface CreateAuthorizationUrlResult {
  readonly authorizationUrl: string;
  readonly codeVerifier?: string | undefined;
}

export interface ExchangeCodeInput {
  readonly platform: SocialPlatform;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier?: string | undefined;
}

export interface ExchangeCodeResult {
  readonly providerAccountId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly accessToken: string;
  readonly refreshToken?: string | null | undefined;
  readonly tokenExpiresInSeconds?: number | null | undefined;
  readonly grantedScopes: readonly string[];
  readonly capabilities: Record<string, boolean>;
  readonly environment: SocialAccountEnvironment;
}

export interface SocialAuthAdapter {
  readonly platform: SocialPlatform;
  createAuthorizationUrl(input: CreateAuthorizationUrlInput): Promise<CreateAuthorizationUrlResult>;
  exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult>;
  revoke?(accessToken: string): Promise<void>;
}

export interface EncryptedSocialCredentials {
  readonly accessTokenCiphertext: Uint8Array;
  readonly accessTokenIv: Uint8Array;
  readonly accessTokenAuthTag: Uint8Array;
  readonly refreshTokenCiphertext: Uint8Array | null;
  readonly refreshTokenIv: Uint8Array | null;
  readonly refreshTokenAuthTag: Uint8Array | null;
  readonly keyVersion: string;
}

export interface DecryptedSocialCredentials {
  readonly accessToken: string;
  readonly refreshToken: string | null;
}

export interface SocialCredentialProtectorPort {
  encrypt(params: {
    readonly workspaceId: string;
    readonly socialAccountId: string;
    readonly platform: SocialPlatform;
    readonly accessToken: string;
    readonly refreshToken?: string | null | undefined;
  }): EncryptedSocialCredentials;
  decrypt(params: {
    readonly workspaceId: string;
    readonly socialAccountId: string;
    readonly platform: SocialPlatform;
    readonly credentials: EncryptedSocialCredentials;
  }): DecryptedSocialCredentials;
}

export interface SocialAuditContext {
  readonly ipHash?: string | null | undefined;
  readonly userAgentSummary?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
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
  readonly expiresAt: string;
  readonly createdAt: string;
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
  readonly encryptedCredentials: EncryptedSocialCredentials;
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
  readonly errorCode: string;
  readonly errorDescription: string;
  readonly resultKeyHash: Uint8Array;
  readonly resultExpiresAt: string;
  readonly now: string;
  readonly auditContext?: SocialAuditContext | undefined;
}

export interface ConsumeCallbackResultParams {
  readonly workspaceId: string;
  readonly resultKeyHash: Uint8Array;
  readonly now: string;
}

export interface SocialPersistencePort {
  saveOAuthTransaction(params: SaveOAuthTransactionParams): Promise<OAuthTransactionSnapshot>;
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
}
