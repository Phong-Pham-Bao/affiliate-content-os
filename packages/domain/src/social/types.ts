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

export const SOCIAL_ACCOUNT_STATUS_REASONS = [
  'none',
  'initial_exchange_complete',
  'transient_failure',
  'token_expired',
  'grant_revoked',
  'refresh_expired',
  'rate_limited',
  'review_pending',
  'kill_switched',
  'reauth_required',
  'disconnected_by_user',
  'reconnect_required',
  'capability_stale',
  'missing_grants',
] as const;
export type SocialAccountStatusReason = (typeof SOCIAL_ACCOUNT_STATUS_REASONS)[number];

export const SOCIAL_ACCOUNT_ACTIONS = ['reconnect', 'refresh', 'disconnect'] as const;
export type SocialAccountAction = (typeof SOCIAL_ACCOUNT_ACTIONS)[number];

export const OAUTH_EXCHANGE_STAGES = [
  'code_received',
  'short_token_exchanged',
  'long_token_exchanged',
  'profile_inspected',
  'completed',
] as const;
export type OAuthExchangeStage = (typeof OAUTH_EXCHANGE_STAGES)[number];

export const EXTERNAL_REVOCATION_RESULTS = ['succeeded', 'failed', 'unsupported'] as const;
export type ExternalRevocationResult = (typeof EXTERNAL_REVOCATION_RESULTS)[number];

export const SOCIAL_ACCOUNT_ENVIRONMENTS = ['production', 'test', 'local'] as const;
export type SocialAccountEnvironment = (typeof SOCIAL_ACCOUNT_ENVIRONMENTS)[number];

export const OAUTH_TRANSACTION_STATUSES = [
  'pending',
  'claimed',
  'consumed',
  'expired',
  'failed',
] as const;
export type OAuthTransactionStatus = (typeof OAUTH_TRANSACTION_STATUSES)[number];

export const OAUTH_CALLBACK_RESULT_STATUSES = ['success', 'failed', 'partial'] as const;
export type OAuthCallbackResultStatus = (typeof OAUTH_CALLBACK_RESULT_STATUSES)[number];

const PLATFORM_SET = new Set<string>(SOCIAL_PLATFORMS);
export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && PLATFORM_SET.has(value);
}

const ACCOUNT_STATUS_SET = new Set<string>(SOCIAL_ACCOUNT_STATUSES);
export function isSocialAccountStatus(value: unknown): value is SocialAccountStatus {
  return typeof value === 'string' && ACCOUNT_STATUS_SET.has(value);
}

const STATUS_REASON_SET = new Set<string>(SOCIAL_ACCOUNT_STATUS_REASONS);
export function isSocialAccountStatusReason(value: unknown): value is SocialAccountStatusReason {
  return typeof value === 'string' && STATUS_REASON_SET.has(value);
}

const ACTION_SET = new Set<string>(SOCIAL_ACCOUNT_ACTIONS);
export function isSocialAccountAction(value: unknown): value is SocialAccountAction {
  return typeof value === 'string' && ACTION_SET.has(value);
}

const EXCHANGE_STAGE_SET = new Set<string>(OAUTH_EXCHANGE_STAGES);
export function isOAuthExchangeStage(value: unknown): value is OAuthExchangeStage {
  return typeof value === 'string' && EXCHANGE_STAGE_SET.has(value);
}

const REVOCATION_RESULT_SET = new Set<string>(EXTERNAL_REVOCATION_RESULTS);
export function isExternalRevocationResult(value: unknown): value is ExternalRevocationResult {
  return typeof value === 'string' && REVOCATION_RESULT_SET.has(value);
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
  readonly statusReason?: SocialAccountStatusReason | null | undefined;
  readonly exchangeStage?: OAuthExchangeStage | undefined;
  readonly grantedScopes: readonly string[];
  readonly capabilities: Record<string, boolean>;
  readonly capabilitiesCheckedAt: string | null;
  readonly tokenExpiresAt: string | null;
  readonly reauthRequiredAt?: string | null | undefined;
  readonly lastRefreshedAt?: string | null | undefined;
  readonly nextRefreshAt?: string | null | undefined;
  readonly connectedByUserId: string;
  readonly disconnectedAt: string | null;
  readonly externalRevocationAttempted?: boolean | undefined;
  readonly externalRevocationSupported?: boolean | undefined;
  readonly externalRevocationResult?: ExternalRevocationResult | null | undefined;
  readonly allowedActions?: readonly SocialAccountAction[] | undefined;
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
  readonly reconnectAccountId?: string | null | undefined;
  readonly expectedProviderAccountId?: string | null | undefined;
  readonly exchangeStage?: OAuthExchangeStage | undefined;
  readonly status: OAuthTransactionStatus;
  readonly claimedAt: string | null;
  readonly claimedExpiresAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly version: number;
}

export interface OAuthCallbackResultSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly initiatedByUserId: string;
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
