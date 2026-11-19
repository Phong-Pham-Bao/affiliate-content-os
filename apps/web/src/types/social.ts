export type SocialPlatform = 'threads' | 'tiktok';

export type SocialAccountStatus =
  'connecting' | 'active' | 'degraded' | 'reauth_required' | 'review_gated' | 'disconnected';

export type SocialAccountAction = 'reconnect' | 'refresh' | 'disconnect';

export type ExternalRevocationResult = 'succeeded' | 'failed' | 'unsupported';

export interface SocialAccountCapabilities {
  readonly canPublishText?: boolean | undefined;
  readonly canPublishMedia?: boolean | undefined;
  readonly isBusinessAccount?: boolean | undefined;
}

export interface SocialAccountDTO {
  readonly id: string;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly providerAccountId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly status: SocialAccountStatus;
  readonly statusReason?: string | null | undefined;
  readonly grantedScopes: readonly string[];
  readonly capabilities: SocialAccountCapabilities;
  readonly capabilitiesCheckedAt: string | null;
  readonly tokenExpiresAt: string | null;
  readonly reauthRequiredAt?: string | null | undefined;
  readonly lastRefreshedAt?: string | null | undefined;
  readonly nextRefreshAt?: string | null | undefined;
  readonly allowedActions?: readonly SocialAccountAction[] | undefined;
  readonly externalRevocationSupported?: boolean | undefined;
  readonly externalRevocationResult?: ExternalRevocationResult | null | undefined;
  readonly connectedByUserId: string;
  readonly disconnectedAt?: string | null | undefined;
  readonly environment: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface SocialAuthorizeResponseDTO {
  readonly authorizationUrl: string;
  readonly transactionId: string;
  readonly expiresAt: string;
}

export interface SocialCallbackResultDTO {
  readonly id: string;
  readonly status: 'success' | 'failed' | 'partial';
  readonly platform: SocialPlatform;
  readonly socialAccountId: string | null;
  readonly errorCode: string | null;
  readonly errorDescription: string | null;
}
