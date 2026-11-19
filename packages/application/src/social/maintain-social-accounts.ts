import crypto from 'node:crypto';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import { executeClaimedSocialAccountRefresh } from './refresh-social-account.js';
import type {
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from './ports.js';

export interface MaintainDueSocialAccountsCommand {
  readonly workerId: string;
  readonly leaseDurationSeconds?: number | undefined;
  readonly maxBatchSize?: number | undefined;
}

export interface MaintainDueSocialAccountsDependencies {
  readonly persistence: SocialPersistencePort;
  readonly protector: SocialCredentialProtectorPort;
  readonly adapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly enabled: boolean;
  readonly socialKillSwitchActive?: boolean | undefined;
  readonly threadsRefreshKillSwitchActive?: boolean | undefined;
  readonly appReviewStatus?: 'development' | 'approved' | undefined;
  readonly threadsHttpTimeoutMs?: number | undefined;
  readonly clock: { now(): Date };
}

export interface MaintainDueSocialAccountsResult {
  readonly processedCount: number;
  readonly claimedCount: number;
  readonly refreshedCount: number;
  readonly failedCount: number;
  readonly deferredCount: number;
}

export async function maintainDueSocialAccounts(
  command: MaintainDueSocialAccountsCommand,
  deps: MaintainDueSocialAccountsDependencies,
): Promise<MaintainDueSocialAccountsResult> {
  if (!deps.enabled || deps.socialKillSwitchActive || deps.threadsRefreshKillSwitchActive) {
    return {
      processedCount: 0,
      claimedCount: 0,
      refreshedCount: 0,
      failedCount: 0,
      deferredCount: 0,
    };
  }

  const maxBatch = command.maxBatchSize ?? 10;
  const leaseDurationSeconds = command.leaseDurationSeconds ?? 120;
  let processedCount = 0;
  let claimedCount = 0;
  let refreshedCount = 0;
  let failedCount = 0;
  let deferredCount = 0;

  for (let i = 0; i < maxBatch; i++) {
    const claimToken = crypto.randomUUID();
    const now = deps.clock.now().toISOString();

    const claimed = await deps.persistence.claimNextDueSocialAccountForRefresh({
      now,
      workerId: command.workerId,
      leaseDurationSeconds,
      claimToken,
    });

    if (!claimed) {
      break;
    }

    claimedCount++;

    try {
      // Execute refresh directly on the already-acquired claim (no double claiming!)
      const result = await executeClaimedSocialAccountRefresh(
        {
          workspaceId: claimed.account.workspaceId,
          accountId: claimed.account.id,
          claim: claimed,
        },
        deps,
      );

      if (result.refreshed) {
        refreshedCount++;
      } else if (
        result.account.status === 'degraded' ||
        result.account.status === 'reauth_required' ||
        result.account.statusReason === 'transient_failure' ||
        result.account.statusReason === 'token_expired' ||
        result.account.statusReason === 'grant_revoked' ||
        result.account.statusReason === 'rate_limited' ||
        result.account.statusReason === 'identity_mismatch'
      ) {
        failedCount++;
      } else {
        deferredCount++;
      }
      processedCount++;
    } catch {
      // If primitive threw before CAS recording failure, ensure lease is released
      try {
        await deps.persistence.releaseSocialAccountRefreshLeaseAtomic({
          workspaceId: claimed.account.workspaceId,
          accountId: claimed.account.id,
          leaseToken: claimed.refreshLeaseToken,
          now: deps.clock.now().toISOString(),
        });
      } catch {
        // Best effort release
      }
      failedCount++;
      processedCount++;
    }
  }

  return {
    processedCount,
    claimedCount,
    refreshedCount,
    failedCount,
    deferredCount,
  };
}
