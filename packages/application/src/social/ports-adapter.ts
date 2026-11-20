import type {
  OAuthExchangeStage,
  SocialAccountEnvironment,
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
  readonly stage?: OAuthExchangeStage | undefined;
  readonly tokenKind?: 'short_lived' | 'long_lived' | undefined;
  readonly isRecoverablePartial?: boolean | undefined;
  readonly inspectionErrorClass?: string | null | undefined;
}

export interface RefreshTokenInput {
  readonly accessToken: string;
}

export interface RefreshTokenResult {
  readonly accessToken: string;
  readonly tokenExpiresInSeconds?: number | null | undefined;
  readonly tokenKind: 'long_lived';
}

export interface RevokeTokenResult {
  readonly supported: boolean;
  readonly revoked: boolean;
}

export interface InspectAccountInput {
  readonly accessToken: string;
  readonly expectedProviderAccountId?: string | undefined;
}

export interface InspectAccountResult {
  readonly providerAccountId: string;
  readonly displayName?: string | null | undefined;
  readonly handle?: string | null | undefined;
  readonly grantedScopes: readonly string[];
  readonly capabilities: Record<string, boolean>;
}

export interface SocialAuthAdapter {
  readonly platform: SocialPlatform;
  readonly supportsRefresh: boolean;
  readonly supportsRevocation: boolean;
  createAuthorizationUrl(input: CreateAuthorizationUrlInput): Promise<CreateAuthorizationUrlResult>;
  exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult>;
  refreshToken?(input: RefreshTokenInput): Promise<RefreshTokenResult>;
  inspectCurrentAccount?(input: InspectAccountInput): Promise<InspectAccountResult>;
  revokeToken?(accessToken?: string): Promise<RevokeTokenResult>;
  revoke?(accessToken: string): Promise<void>;
}
