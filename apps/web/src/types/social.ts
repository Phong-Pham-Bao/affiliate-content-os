export type SocialPlatform = 'threads' | 'tiktok';

export type SocialAccountStatus =
  'connecting' | 'active' | 'degraded' | 'reauth_required' | 'review_gated' | 'disconnected';

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
  readonly grantedScopes: readonly string[];
  readonly capabilities: SocialAccountCapabilities;
  readonly capabilitiesCheckedAt: string | null;
  readonly tokenExpiresAt: string | null;
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
  readonly status: 'success' | 'failed';
  readonly platform: SocialPlatform;
  readonly socialAccountId: string | null;
  readonly errorCode: string | null;
  readonly errorDescription: string | null;
}
