export const SOCIAL_PLATFORMS = ['threads', 'tiktok'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_ACCOUNT_STATUSES = [
  'connecting',
  'active',
  'degraded',
  'reauth_required',
  'review_gated',
  'disconnected',
] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const SOCIAL_ACCOUNT_ENVIRONMENTS = ['production', 'test', 'local'] as const;
export type SocialAccountEnvironment = (typeof SOCIAL_ACCOUNT_ENVIRONMENTS)[number];

export const OAUTH_TRANSACTION_STATUSES = ['pending', 'consumed', 'expired', 'failed'] as const;
export type OAuthTransactionStatus = (typeof OAUTH_TRANSACTION_STATUSES)[number];

export const OAUTH_CALLBACK_RESULT_STATUSES = ['success', 'failed'] as const;
export type OAuthCallbackResultStatus = (typeof OAUTH_CALLBACK_RESULT_STATUSES)[number];

const PLATFORM_SET = new Set<string>(SOCIAL_PLATFORMS);
export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && PLATFORM_SET.has(value);
}

const ACCOUNT_STATUS_SET = new Set<string>(SOCIAL_ACCOUNT_STATUSES);
export function isSocialAccountStatus(value: unknown): value is SocialAccountStatus {
  return typeof value === 'string' && ACCOUNT_STATUS_SET.has(value);
}

const ENVIRONMENT_SET = new Set<string>(SOCIAL_ACCOUNT_ENVIRONMENTS);
export function isSocialAccountEnvironment(value: unknown): value is SocialAccountEnvironment {
  return typeof value === 'string' && ENVIRONMENT_SET.has(value);
}

const TRANSACTION_STATUS_SET = new Set<string>(OAUTH_TRANSACTION_STATUSES);
export function isOAuthTransactionStatus(value: unknown): value is OAuthTransactionStatus {
  return typeof value === 'string' && TRANSACTION_STATUS_SET.has(value);
}

const CALLBACK_RESULT_STATUS_SET = new Set<string>(OAUTH_CALLBACK_RESULT_STATUSES);
export function isOAuthCallbackResultStatus(value: unknown): value is OAuthCallbackResultStatus {
  return typeof value === 'string' && CALLBACK_RESULT_STATUS_SET.has(value);
}

export interface SocialAccountSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly providerAccountId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly status: SocialAccountStatus;
  readonly grantedScopes: readonly string[];
  readonly capabilities: Record<string, boolean>;
  readonly capabilitiesCheckedAt: string | null;
  readonly tokenExpiresAt: string | null;
  readonly connectedByUserId: string;
  readonly disconnectedAt: string | null;
  readonly environment: SocialAccountEnvironment;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface OAuthTransactionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly platform: SocialPlatform;
  readonly initiatedByUserId: string;
  readonly stateHash: Uint8Array;
  readonly redirectUri: string;
  readonly returnTo: string;
  readonly requestedScopes: readonly string[];
  readonly status: OAuthTransactionStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly version: number;
}

export interface OAuthCallbackResultSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly resultKeyHash: Uint8Array;
  readonly status: OAuthCallbackResultStatus;
  readonly platform: SocialPlatform;
  readonly socialAccountId: string | null;
  readonly errorCode: string | null;
  readonly errorDescription: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly version: number;
}
