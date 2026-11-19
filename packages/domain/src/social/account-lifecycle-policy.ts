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

function computeNextRefresh(
  tokenExpiresAt: string | null,
  now: Date,
  status: SocialAccountStatus,
): string | null {
  if (status !== 'active' && status !== 'review_gated') {
    return null;
  }
  if (tokenExpiresAt) {
    const expiresMs = new Date(tokenExpiresAt).getTime();
    const candidateMs = expiresMs - DEFAULT_DAYS_BEFORE_EXPIRY_REFRESH * 24 * 60 * 60 * 1000;
    // If candidate time is already in the past, schedule for 1 hour from now
    if (candidateMs <= now.getTime()) {
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    }
    return new Date(candidateMs).toISOString();
  }
  return new Date(
    now.getTime() + DEFAULT_REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function deriveAccountLifecycle(
  input: DeriveAccountLifecycleInput,
): DerivedAccountLifecycle {
  const { now } = input;

  // 1. Disconnected state: permanently inactive until explicit reconnect
  if (input.disconnectedAt || input.previousStatus === 'disconnected') {
    return Object.freeze({
      status: 'disconnected',
      statusReason: 'disconnected_by_user',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['reconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: null,
    });
  }

  // 2. Kill switch active: fail-closed to degraded state
  if (input.killSwitches.globalKillSwitch || input.killSwitches.connectionKillSwitch) {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'kill_switched',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: null,
    });
  }

  // 3. Credential missing or invalidated
  if (!input.hasValidCredential) {
    return Object.freeze({
      status: 'reauth_required',
      statusReason: 'reauth_required',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
    });
  }

  // 4. Token expired
  if (input.tokenExpiresAt && new Date(input.tokenExpiresAt).getTime() <= now.getTime()) {
    return Object.freeze({
      status: 'reauth_required',
      statusReason: 'token_expired',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
    });
  }

  // 5. Terminal provider auth errors
  if (input.lastInspectionErrorClass === 'token_expired') {
    return Object.freeze({
      status: 'reauth_required',
      statusReason: 'token_expired',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
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
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
    });
  }

  // 6. Partial exchange or transient / rate-limited failures
  if (input.exchangeStage !== 'completed') {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'transient_failure',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
      nextRefreshAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      reauthRequiredAt: null,
    });
  }
  if (input.lastInspectionErrorClass === 'rate_limited') {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'rate_limited',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
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
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
      nextRefreshAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      reauthRequiredAt: null,
    });
  }

  // 7. Identity verification check
  if (!input.verifiedIdentity || !input.verifiedIdentity.providerAccountId) {
    return Object.freeze({
      status: 'degraded',
      statusReason: 'transient_failure',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['reconnect', 'disconnect'] as const),
      nextRefreshAt: null,
      reauthRequiredAt: null,
    });
  }

  // 8. App review gating check
  if (input.appReviewStatus !== 'approved') {
    return Object.freeze({
      status: 'review_gated',
      statusReason: 'review_pending',
      capabilities: Object.freeze({ canPublishText: false, canPublishMedia: false }),
      allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
      nextRefreshAt: computeNextRefresh(input.tokenExpiresAt, now, 'review_gated'),
      reauthRequiredAt: null,
    });
  }

  // 9. Fully active state
  const hasBasic = input.grantedScopes.includes('threads_basic');
  const hasPublish = input.grantedScopes.includes('threads_content_publish');

  const canPublishText = hasBasic && hasPublish;
  const canPublishMedia = false; // Intentionally gated until TASK-019

  return Object.freeze({
    status: 'active',
    statusReason: 'initial_exchange_complete',
    capabilities: Object.freeze({ canPublishText, canPublishMedia }),
    allowedActions: Object.freeze(['refresh', 'reconnect', 'disconnect'] as const),
    nextRefreshAt: computeNextRefresh(input.tokenExpiresAt, now, 'active'),
    reauthRequiredAt: null,
  });
}
