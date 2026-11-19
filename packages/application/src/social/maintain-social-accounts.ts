import crypto from 'node:crypto';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import { refreshSocialAccount } from './refresh-social-account.js';
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
  readonly clock: { now(): Date };
}

export interface MaintainDueSocialAccountsResult {
  readonly processedCount: number;
}

export async function maintainDueSocialAccounts(
  command: MaintainDueSocialAccountsCommand,
  deps: MaintainDueSocialAccountsDependencies,
): Promise<MaintainDueSocialAccountsResult> {
  if (!deps.enabled) {
    return { processedCount: 0 };
  }

  const maxBatch = command.maxBatchSize ?? 10;
  let processed = 0;

  for (let i = 0; i < maxBatch; i++) {
    const claimToken = crypto.randomUUID();
    const now = deps.clock.now().toISOString();

    const claimed = await deps.persistence.claimNextDueSocialAccountForRefresh({
      now,
      workerId: command.workerId,
      leaseDurationSeconds: command.leaseDurationSeconds ?? 60,
      claimToken,
    });

    if (!claimed) {
      break;
    }

    try {
      await refreshSocialAccount(
        {
          workspaceId: claimed.account.workspaceId,
          accountId: claimed.account.id,
        },
        deps,
      );
    } catch {
      // Background maintenance swallows individual account refresh errors
      // after attempting lease release / recording failure
    }

    processed++;
  }

  return { processedCount: processed };
}
