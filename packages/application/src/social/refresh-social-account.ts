import crypto from 'node:crypto';
import {
  deriveAccountLifecycle,
  parseUserId,
  parseWorkspaceId,
  type SocialAccountSnapshot,
  type SocialPlatform,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { WorkspaceAuthorizationPort } from '../ports.js';
import {
  SocialAccountDisconnectedError,
  SocialAccountNotFoundError,
  SocialAccountReauthRequiredError,
  SocialAuthNotConfiguredError,
  SocialAuthOutcomeUnknownError,
  SocialAuthRateLimitError,
  SocialAuthTerminalError,
  SocialCredentialEncryptionError,
  SocialKillSwitchActiveError,
  SocialPlatformUnsupportedError,
} from './errors.js';
import { calculateRefreshLeaseDurationSeconds } from './lease-budget.js';
import type {
  ClaimedSocialAccountRefresh,
  InspectAccountResult,
  SocialAuditContext,
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from './ports.js';

export interface RefreshSocialAccountCommand {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly actorUserId?: string | undefined;
  readonly auditContext?: SocialAuditContext | undefined;
  readonly claimToken?: string | undefined;
  readonly operationId?: string | undefined;
}

export interface RefreshSocialAccountDependencies {
  readonly persistence: SocialPersistencePort;
  readonly workspaceAuthorization?: WorkspaceAuthorizationPort | undefined;
  readonly protector: SocialCredentialProtectorPort;
  readonly adapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly enabled: boolean;
  readonly socialKillSwitchActive?: boolean | undefined;
  readonly threadsRefreshKillSwitchActive?: boolean | undefined;
  readonly appReviewStatus?: 'development' | 'approved' | undefined;
  readonly threadsHttpTimeoutMs?: number | undefined;
  readonly clock: { now(): Date };
}

export interface RefreshSocialAccountResult {
  readonly account: SocialAccountSnapshot;
  readonly refreshed: boolean;
}

export interface ExecuteClaimedRefreshParams {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly claim: ClaimedSocialAccountRefresh;
  readonly actorUserId?: string | undefined;
  readonly auditContext?: SocialAuditContext | undefined;
  readonly operationId?: string | undefined;
}

/**
 * Single internal execution primitive for social account refresh.
 * Accepts an already-acquired ClaimedSocialAccountRefresh and executes:
 * decrypt -> provider refresh/inspection -> encrypt -> fenced completion/failure/release.
 */
export async function executeClaimedSocialAccountRefresh(
  params: ExecuteClaimedRefreshParams,
  deps: RefreshSocialAccountDependencies,
): Promise<RefreshSocialAccountResult> {
  const now = deps.clock.now();
  const account = params.claim.account;
  const adapter = deps.adapters.get(account.platform);

  if (!adapter) {
    await deps.persistence.releaseSocialAccountRefreshLeaseAtomic({
      workspaceId: params.workspaceId,
      accountId: params.accountId,
      leaseToken: params.claim.refreshLeaseToken,
      now: now.toISOString(),
    });
    throw new SocialPlatformUnsupportedError(account.platform);
  }

  // 1. Decrypt credentials narrowly outside DB transaction
  let decrypted;
  try {
    decrypted = deps.protector.decrypt({
      workspaceId: params.workspaceId,
      socialAccountId: params.accountId,
      platform: account.platform,
      credentials: params.claim.encryptedCredentials,
    });
  } catch {
    const updated = await deps.persistence.recordFailedSocialAccountRefreshAtomic({
      workspaceId: params.workspaceId,
      accountId: params.accountId,
      expectedAccountVersion: params.claim.claimedAccountVersion,
      expectedLeaseToken: params.claim.refreshLeaseToken,
      derivedStatus: 'reauth_required',
      statusReason: 'reauth_required',
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
      now: now.toISOString(),
      actorUserId: params.actorUserId,
      auditContext: params.auditContext,
      operationId: params.operationId,
      operationLeaseToken: params.claim.refreshLeaseToken,
    });
    return { account: updated, refreshed: false };
  }

  if (!adapter.supportsRefresh || !adapter.refreshToken) {
    await deps.persistence.releaseSocialAccountRefreshLeaseAtomic({
      workspaceId: params.workspaceId,
      accountId: params.accountId,
      leaseToken: params.claim.refreshLeaseToken,
      now: now.toISOString(),
    });
    return { account, refreshed: false };
  }

  // 2. Persist provider_attempt_started transition before external refresh call
  if (
    params.operationId &&
    params.claim.refreshLeaseToken &&
    typeof deps.persistence.markOperationAttemptStarted === 'function'
  ) {
    await deps.persistence.markOperationAttemptStarted({
      operationId: params.operationId,
      leaseToken: params.claim.refreshLeaseToken,
    });
  }

  // 3. Call provider refresh OUTSIDE database transaction
  let newAccessToken: string;
  let tokenExpiresInSeconds: number | null | undefined;
  try {
    const refreshRes = await adapter.refreshToken({ accessToken: decrypted.accessToken });
    newAccessToken = refreshRes.accessToken;
    tokenExpiresInSeconds = refreshRes.tokenExpiresInSeconds;
  } catch (err: unknown) {
    if (err instanceof SocialAuthOutcomeUnknownError) {
      // Special-case SocialAuthOutcomeUnknownError thrown by refreshToken():
      // Atomically fence the refresh claim and set account to reauth_required state
      await deps.persistence.recordFailedSocialAccountRefreshAtomic({
        workspaceId: params.workspaceId,
        accountId: params.accountId,
        expectedAccountVersion: params.claim.claimedAccountVersion,
        expectedLeaseToken: params.claim.refreshLeaseToken,
        derivedStatus: 'reauth_required',
        statusReason: 'reauth_required',
        nextRefreshAt: null,
        reauthRequiredAt: now.toISOString(),
        now: now.toISOString(),
        actorUserId: params.actorUserId,
        auditContext: params.auditContext,
      });
      // Do not return HTTP 200 degraded success. Propagate so idempotency operation is terminally failed with OUTCOME_UNKNOWN.
      throw err;
    }

    const isRateLimit = err instanceof SocialAuthRateLimitError;
    const isAuthTerminal = err instanceof SocialAuthTerminalError;

    const derivedStatus = isAuthTerminal ? 'reauth_required' : 'degraded';
    let statusReason: 'token_expired' | 'grant_revoked' | 'rate_limited' | 'transient_failure' =
      'transient_failure';
    if (isAuthTerminal) {
      statusReason =
        (err as SocialAuthTerminalError).reason === 'invalid_grant'
          ? 'grant_revoked'
          : 'token_expired';
    } else if (isRateLimit) {
      statusReason = 'rate_limited';
    }

    const retrySec = isRateLimit
      ? ((err as SocialAuthRateLimitError).retryAfterSeconds ?? 1800)
      : 900;
    const nextRefreshAt = isAuthTerminal
      ? null
      : new Date(now.getTime() + retrySec * 1000).toISOString();

    const updated = await deps.persistence.recordFailedSocialAccountRefreshAtomic({
      workspaceId: params.workspaceId,
      accountId: params.accountId,
      expectedAccountVersion: params.claim.claimedAccountVersion,
      expectedLeaseToken: params.claim.refreshLeaseToken,
      derivedStatus,
      statusReason,
      nextRefreshAt,
      reauthRequiredAt: isAuthTerminal ? now.toISOString() : null,
      now: now.toISOString(),
      actorUserId: params.actorUserId,
      auditContext: params.auditContext,
      operationId: params.operationId,
      operationLeaseToken: params.claim.refreshLeaseToken,
    });

    return { account: updated, refreshed: false };
  }

  // 3. Inspect current account identity and granted permissions
  // Never reuse old scopes as freshly checked evidence
  let inspection: InspectAccountResult | null = null;
  let inspectionFailed = false;
  let identityMismatch = false;

  if (typeof adapter.inspectCurrentAccount === 'function') {
    try {
      const inspRes = await adapter.inspectCurrentAccount({ accessToken: newAccessToken });
      if (inspRes.providerAccountId !== account.providerAccountId) {
        identityMismatch = true;
      } else {
        inspection = inspRes;
      }
    } catch {
      inspectionFailed = true;
    }
  }

  if (identityMismatch) {
    // Current profile ID from provider does NOT match stored provider account ID
    const updated = await deps.persistence.recordFailedSocialAccountRefreshAtomic({
      workspaceId: params.workspaceId,
      accountId: params.accountId,
      expectedAccountVersion: params.claim.claimedAccountVersion,
      expectedLeaseToken: params.claim.refreshLeaseToken,
      derivedStatus: 'reauth_required',
      statusReason: 'identity_mismatch',
      nextRefreshAt: null,
      reauthRequiredAt: now.toISOString(),
      now: now.toISOString(),
      actorUserId: params.actorUserId,
      auditContext: params.auditContext,
      operationId: params.operationId,
      operationLeaseToken: params.claim.refreshLeaseToken,
    });
    return { account: updated, refreshed: false };
  }

  // 4. Encrypt rotated replacement credentials
  let encrypted;
  try {
    encrypted = deps.protector.encrypt({
      workspaceId: params.workspaceId,
      socialAccountId: params.accountId,
      platform: account.platform,
      accessToken: newAccessToken,
      refreshToken: decrypted.refreshToken,
    });
  } catch {
    await deps.persistence.releaseSocialAccountRefreshLeaseAtomic({
      workspaceId: params.workspaceId,
      accountId: params.accountId,
      leaseToken: params.claim.refreshLeaseToken,
      now: now.toISOString(),
    });
    throw new SocialCredentialEncryptionError('Failed to encrypt rotated credentials');
  }

  const tokenExpiresAt =
    tokenExpiresInSeconds && tokenExpiresInSeconds > 0
      ? new Date(now.getTime() + tokenExpiresInSeconds * 1000).toISOString()
      : account.tokenExpiresAt;

  // Determine capabilities, granted scopes, and capabilitiesCheckedAt
  let capabilitiesCheckedAt: string | null;
  let grantedScopes: readonly string[];
  let capabilities: Record<string, boolean>;
  let displayName: string;
  let handle: string | null;

  if (inspection) {
    // Verified inspection succeeded with matching identity and fresh grants
    capabilitiesCheckedAt = now.toISOString();
    grantedScopes = inspection.grantedScopes;
    capabilities = inspection.capabilities;
    displayName = inspection.displayName ?? account.displayName;
    handle = inspection.handle ?? account.handle;
  } else {
    // Inspection failed or unsupported: token rotated safely, but capabilitiesCheckedAt NOT refreshed
    capabilitiesCheckedAt = account.capabilitiesCheckedAt;
    grantedScopes = account.grantedScopes;
    capabilities = account.capabilities;
    displayName = account.displayName;
    handle = account.handle;
  }

  const lifecycle = deriveAccountLifecycle({
    platform: account.platform,
    exchangeStage: 'completed',
    hasValidCredential: true,
    tokenExpiresAt,
    verifiedIdentity: {
      providerAccountId: account.providerAccountId,
      displayName,
    },
    grantedScopes,
    capabilitiesCheckedAt,
    lastInspectionErrorClass: inspectionFailed ? 'transient_network' : null,
    appReviewStatus: deps.appReviewStatus ?? 'development',
    killSwitches: {
      globalKillSwitch: deps.socialKillSwitchActive,
      refreshKillSwitch: deps.threadsRefreshKillSwitchActive,
    },
    now,
  });

  // 5. Atomically rotate credential and update account under CAS and claim fencing
  const updatedAccount = await deps.persistence.completeSocialAccountRefreshAtomic({
    workspaceId: params.workspaceId,
    accountId: params.accountId,
    expectedAccountVersion: params.claim.claimedAccountVersion,
    expectedCredentialVersion: params.claim.claimedCredentialVersion,
    expectedLeaseToken: params.claim.refreshLeaseToken,
    encryptedCredentials: encrypted,
    tokenExpiresAt,
    nextRefreshAt: lifecycle.nextRefreshAt,
    capabilitiesCheckedAt,
    grantedScopes,
    capabilities,
    displayName,
    handle,
    derivedStatus: lifecycle.status,
    statusReason: lifecycle.statusReason,
    now: now.toISOString(),
    actorUserId: params.actorUserId,
    auditContext: params.auditContext,
    operationId: params.operationId,
    operationLeaseToken: params.claim.refreshLeaseToken,
  });

  return { account: updatedAccount, refreshed: true };
}

export async function refreshSocialAccount(
  command: RefreshSocialAccountCommand,
  deps: RefreshSocialAccountDependencies,
): Promise<RefreshSocialAccountResult> {
  if (!deps.enabled) throw new SocialAuthNotConfiguredError();
  if (deps.socialKillSwitchActive || deps.threadsRefreshKillSwitchActive) {
    throw new SocialKillSwitchActiveError();
  }

  if (command.actorUserId && deps.workspaceAuthorization) {
    await authorizeWorkspaceAction(
      {
        workspaceId: parseWorkspaceId(command.workspaceId),
        userId: parseUserId(command.actorUserId),
        capability: 'social_accounts.manage',
      },
      { authorization: deps.workspaceAuthorization },
    );
  }

  const now = deps.clock.now();
  const claimToken = command.claimToken ?? crypto.randomUUID();

  // 0. Proactively verify account status - if reauth is required, reject immediately!
  const existing = await deps.persistence.findSocialAccountById({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
  });
  if (!existing) throw new SocialAccountNotFoundError();
  if (existing.status === 'reauth_required') {
    throw new SocialAccountReauthRequiredError(
      'Social account requires reauthorization. Please reconnect the account.',
    );
  }
  if (existing.status === 'disconnected') {
    throw new SocialAccountDisconnectedError('Social account is disconnected.');
  }

  // Derive unified lease duration using shared worst-case lease budget helper
  const leaseDurationSeconds = calculateRefreshLeaseDurationSeconds(deps.threadsHttpTimeoutMs);

  // 1. Claim account for refresh (atomic exclusive claim, enforcing earliest_refresh_at)
  const claimed = await deps.persistence.claimSocialAccountForRefresh({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
    leaseDurationSeconds,
    claimToken,
    now: now.toISOString(),
  });

  if (!claimed) {
    return { account: existing, refreshed: false };
  }

  // 2. Delegate to the single execution primitive
  return executeClaimedSocialAccountRefresh(
    {
      workspaceId: command.workspaceId,
      accountId: command.accountId,
      claim: claimed,
      actorUserId: command.actorUserId,
      auditContext: command.auditContext,
      operationId: command.operationId,
    },
    deps,
  );
}
