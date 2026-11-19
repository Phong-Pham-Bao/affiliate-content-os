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
  SocialAccountNotFoundError,
  SocialAuthNotConfiguredError,
  SocialAuthRateLimitError,
  SocialKillSwitchActiveError,
  SocialPlatformUnsupportedError,
} from './errors.js';
import type {
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
  readonly clock: { now(): Date };
}

export interface RefreshSocialAccountResult {
  readonly account: SocialAccountSnapshot;
  readonly refreshed: boolean;
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

  // 1. Claim account for refresh (short DB transaction / advisory lock lease)
  const claimed = await deps.persistence.claimSocialAccountForRefresh({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
    leaseDurationSeconds: 60,
    now: now.toISOString(),
  });

  if (!claimed) {
    const existing = await deps.persistence.findSocialAccountById({
      workspaceId: command.workspaceId,
      accountId: command.accountId,
    });
    if (!existing) throw new SocialAccountNotFoundError();
    return { account: existing, refreshed: false };
  }

  const account = claimed.account;
  const adapter = deps.adapters.get(account.platform);
  if (!adapter) throw new SocialPlatformUnsupportedError(account.platform);

  // 2. Decrypt credentials narrowly outside DB transaction
  const decrypted = deps.protector.decrypt({
    workspaceId: command.workspaceId,
    socialAccountId: command.accountId,
    platform: account.platform,
    credentials: claimed.encryptedCredentials,
  });

  if (!adapter.supportsRefresh || !adapter.refreshToken) {
    // Adapter does not support refresh; record verified check
    return { account, refreshed: false };
  }

  // 3. Call provider refresh OUTSIDE database transaction
  let newAccessToken: string;
  let tokenExpiresInSeconds: number | null | undefined;
  try {
    const refreshRes = await adapter.refreshToken({ accessToken: decrypted.accessToken });
    newAccessToken = refreshRes.accessToken;
    tokenExpiresInSeconds = refreshRes.tokenExpiresInSeconds;
  } catch (err: unknown) {
    const isRateLimit = err instanceof SocialAuthRateLimitError;
    const isAuthTerminal =
      err instanceof Error &&
      (err.message.includes('expired') ||
        err.message.includes('revoked') ||
        err.message.includes('invalid_token'));

    const derivedStatus = isAuthTerminal ? 'reauth_required' : 'degraded';
    const statusReason = isAuthTerminal
      ? 'token_expired'
      : isRateLimit
        ? 'rate_limited'
        : 'transient_failure';

    const retrySec = isRateLimit
      ? ((err as SocialAuthRateLimitError).retryAfterSeconds ?? 1800)
      : 900;
    const nextRefreshAt = isAuthTerminal
      ? null
      : new Date(now.getTime() + retrySec * 1000).toISOString();

    const updated = await deps.persistence.recordFailedSocialAccountRefreshAtomic({
      workspaceId: command.workspaceId,
      accountId: command.accountId,
      expectedAccountVersion: claimed.claimedAccountVersion,
      derivedStatus,
      statusReason,
      nextRefreshAt,
      reauthRequiredAt: isAuthTerminal ? now.toISOString() : null,
      now: now.toISOString(),
      actorUserId: command.actorUserId,
      auditContext: command.auditContext,
    });

    return { account: updated, refreshed: false };
  }

  // 4. Encrypt new replacement token with fresh nonce and bound AAD
  const encrypted = deps.protector.encrypt({
    workspaceId: command.workspaceId,
    socialAccountId: command.accountId,
    platform: account.platform,
    accessToken: newAccessToken,
    refreshToken: decrypted.refreshToken,
  });

  const tokenExpiresAt =
    tokenExpiresInSeconds && tokenExpiresInSeconds > 0
      ? new Date(now.getTime() + tokenExpiresInSeconds * 1000).toISOString()
      : account.tokenExpiresAt;

  const lifecycle = deriveAccountLifecycle({
    platform: account.platform,
    exchangeStage: 'completed',
    hasValidCredential: true,
    tokenExpiresAt,
    verifiedIdentity: {
      providerAccountId: account.providerAccountId,
      displayName: account.displayName,
    },
    grantedScopes: account.grantedScopes,
    capabilitiesCheckedAt: now.toISOString(),
    appReviewStatus: deps.appReviewStatus ?? 'development',
    killSwitches: {
      globalKillSwitch: deps.socialKillSwitchActive,
      refreshKillSwitch: deps.threadsRefreshKillSwitchActive,
    },
    now,
  });

  // 5. Atomically rotate credential and update account under CAS
  const updatedAccount = await deps.persistence.completeSocialAccountRefreshAtomic({
    workspaceId: command.workspaceId,
    accountId: command.accountId,
    expectedAccountVersion: claimed.claimedAccountVersion,
    expectedCredentialVersion: claimed.claimedCredentialVersion,
    encryptedCredentials: encrypted,
    tokenExpiresAt,
    nextRefreshAt: lifecycle.nextRefreshAt,
    derivedStatus: lifecycle.status,
    statusReason: lifecycle.statusReason,
    now: now.toISOString(),
    actorUserId: command.actorUserId,
    auditContext: command.auditContext,
  });

  return { account: updatedAccount, refreshed: true };
}
