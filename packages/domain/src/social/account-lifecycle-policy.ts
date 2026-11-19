import type {
  OAuthExchangeStage,
  SocialAccountAction,
  SocialAccountStatus,
  SocialAccountStatusReason,
  SocialPlatform,
} from './types.js';

export type InspectionErrorClass =
  | 'transient_network'
  | 'rate_limited'
  | 'token_expired'
  | 'token_revoked'
  | 'invalid_grant'
  | 'provider_error'
  | 'provider_timeout'
  | 'outcome_unknown';

export interface DeriveAccountLifecycleInput {
  readonly platform: SocialPlatform;
  readonly previousStatus?: SocialAccountStatus | undefined;
  readonly exchangeStage: OAuthExchangeStage;
  readonly hasValidCredential: boolean;
  readonly tokenExpiresAt: string | null;
  readonly verifiedIdentity: {
    readonly providerAccountId: string;
    readonly displayName: string;
  } | null;
  readonly grantedScopes: readonly string[];
  readonly capabilitiesCheckedAt: string | null;
  readonly lastInspectionErrorClass?: InspectionErrorClass | null | undefined;
  readonly appReviewStatus: 'development' | 'approved';
  readonly killSwitches: {
    readonly globalKillSwitch?: boolean | undefined;
    readonly connectionKillSwitch?: boolean | undefined;
    readonly refreshKillSwitch?: boolean | undefined;
  };
  readonly disconnectedAt?: string | null | undefined;
  readonly now: Date;
  readonly capabilityFreshnessMaxAgeMs?: number | undefined;
}

export interface DerivedAccountLifecycle {
  readonly status: SocialAccountStatus;
  readonly statusReason: SocialAccountStatusReason;
  readonly capabilities: {
    readonly canPublishText: boolean;
    readonly canPublishMedia: boolean;
  };
  readonly allowedActions: readonly SocialAccountAction[];
  readonly nextRefreshAt: string | null;
  readonly reauthRequiredAt: string | null;
}

const DEFAULT_DAYS_BEFORE_EXPIRY_REFRESH = 7;
const DEFAULT_REFRESH_INTERVAL_DAYS = 30;
export const DEFAULT_CAPABILITY_FRESHNESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function computeNextRefresh(
  tokenExpiresAt: string | null,
  now: Date,
  status: SocialAccountStatus,
): string | null {
  if (status !== 'active' && status !== 'review_gated') return null;
  if (tokenExpiresAt) {
    const candidateMs =
      new Date(tokenExpiresAt).getTime() - DEFAULT_DAYS_BEFORE_EXPIRY_REFRESH * 24 * 60 * 60 * 1000;
    if (candidateMs <= now.getTime()) {
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    }
    return new Date(candidateMs).toISOString();
  }
  return new Date(
    now.getTime() + DEFAULT_REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function isFreshEvidence(
  checkedAtStr: string | null,
  now: Date,
  maxAgeMs: number = DEFAULT_CAPABILITY_FRESHNESS_MAX_AGE_MS,
): boolean {
  if (!checkedAtStr) return false;
  const checkedMs = new Date(checkedAtStr).getTime();
  if (Number.isNaN(checkedMs)) return false;
  if (checkedMs > now.getTime() + 60_000) return false; // future-skewed
  return now.getTime() - checkedMs <= maxAgeMs;
}

export function deriveAccountLifecycle(
  input: DeriveAccountLifecycleInput,
): DerivedAccountLifecycle {
  const { now } = input;
  const noPub = Object.freeze({ canPublishText: false, canPublishMedia: false });

  if (input.disconnectedAt || input.previousStatus === 'disconnected') {
    return Object.freeze({
      status: 'disconnected',
      statusReason: 'disconnected_by_user',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: null,
    });
  }

  if (input.killSwitches.globalKillSwitch || input.killSwitches.connectionKillSwitch) {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'kill_switched',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: null,
    });
  }

  if (!input.hasValidCredential) {
    return Object.freeze({
      status: 'reauth_required',
      statusReason: 'reauth_required',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
    });
  }

  if (input.tokenExpiresAt && new Date(input.tokenExpiresAt).getTime() <= now.getTime()) {
    return Object.freeze({
      status: 'reauth_required',
      statusReason: 'token_expired',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
    });
  }

  if (input.lastInspectionErrorClass === 'token_expired') {
    return Object.freeze({
      status: 'reauth_required',
      statusReason: 'token_expired',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
    });
  }
  if (
    input.lastInspectionErrorClass === 'token_revoked' ||
    input.lastInspectionErrorClass === 'invalid_grant'
  ) {
    return Object.freeze({
      status: 'reauth_required',
      statusReason: 'grant_revoked',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
    });
  }

  if (input.exchangeStage !== 'completed') {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'transient_failure',
      capabilities: noPub,
      allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
      nextRefreshAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      reauthRequiredAt: null,
    });
  }

  if (input.lastInspectionErrorClass === 'rate_limited') {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'rate_limited',
      capabilities: noPub,
      allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
      nextRefreshAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      reauthRequiredAt: null,
    });
  }
  if (
    input.lastInspectionErrorClass === 'transient_network' ||
    input.lastInspectionErrorClass === 'provider_error' ||
    input.lastInspectionErrorClass === 'provider_timeout' ||
    input.lastInspectionErrorClass === 'outcome_unknown'
  ) {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'transient_failure',
      capabilities: noPub,
      allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
      nextRefreshAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      reauthRequiredAt: null,
    });
  }

  if (
    !input.verifiedIdentity ||
    !input.verifiedIdentity.providerAccountId ||
    !input.verifiedIdentity.displayName
  ) {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'transient_failure',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: null,
    });
  }

  // Capability freshness enforcement: missing, invalid, future-skewed, or stale
  if (!isFreshEvidence(input.capabilitiesCheckedAt, now, input.capabilityFreshnessMaxAgeMs)) {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'capability_stale',
      capabilities: noPub,
      allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
      nextRefreshAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      reauthRequiredAt: null,
    });
  }

  // Required grants enforcement: threads_basic and threads_content_publish
  const hasBasic = input.grantedScopes.includes('threads_basic');
  const hasPublish = input.grantedScopes.includes('threads_content_publish');

  if (!hasBasic) {
    return Object.freeze({
      status: 'reauth_required',
      statusReason: 'grant_revoked',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
    });
  }

  if (!hasPublish) {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'missing_grants',
      capabilities: noPub,
      allowedActions: Object.freeze(['reconnect', 'refresh', 'disconnect'] as const),
      nextRefreshAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      reauthRequiredAt: null,
    });
  }

  if (input.appReviewStatus !== 'approved') {
    return Object.freeze({
      status: 'review_gated',
      statusReason: 'review_pending',
      capabilities: noPub,
      allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
      nextRefreshAt: computeNextRefresh(input.tokenExpiresAt, now, 'review_gated'),
      reauthRequiredAt: null,
    });
  }

  return Object.freeze({
    status: 'active',
    statusReason: 'initial_exchange_complete',
    capabilities: Object.freeze({ canPublishText: true, canPublishMedia: false }),
    allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
    nextRefreshAt: computeNextRefresh(input.tokenExpiresAt, now, 'active'),
    reauthRequiredAt: null,
  });
}
