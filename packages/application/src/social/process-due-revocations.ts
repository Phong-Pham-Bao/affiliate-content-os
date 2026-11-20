import crypto from 'node:crypto';
import type { SocialPlatform } from '@affiliate-content-os/domain';
import { classifyOperationSafeError } from './errors.js';
import type {
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from './ports.js';

export interface ProcessDueRevocationsCommand {
  readonly workerId: string;
  readonly leaseDurationSeconds?: number | undefined;
  readonly maxBatchSize?: number | undefined;
}

export interface ProcessDueRevocationsDependencies {
  readonly persistence: SocialPersistencePort;
  readonly protector: SocialCredentialProtectorPort;
  readonly adapters: ReadonlyMap<SocialPlatform, SocialAuthAdapter>;
  readonly enabled: boolean;
  readonly socialKillSwitchActive?: boolean | undefined;
  readonly clock: { now(): Date };
}

export interface ProcessDueRevocationsResult {
  readonly processedCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
}

export async function processDueSocialAccountRevocations(
  command: ProcessDueRevocationsCommand,
  deps: ProcessDueRevocationsDependencies,
): Promise<ProcessDueRevocationsResult> {
  if (!deps.enabled || deps.socialKillSwitchActive) {
    return { processedCount: 0, succeededCount: 0, failedCount: 0 };
  }
  if (typeof deps.persistence.claimNextDueSocialAccountRevocationJob !== 'function') {
    return { processedCount: 0, succeededCount: 0, failedCount: 0 };
  }

  const maxBatch = command.maxBatchSize ?? 5;
  const leaseDurationSeconds = command.leaseDurationSeconds ?? 60;
  let processedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  for (let i = 0; i < maxBatch; i++) {
    const claimToken = crypto.randomUUID();
    const now = deps.clock.now().toISOString();

    const job = await deps.persistence.claimNextDueSocialAccountRevocationJob({
      now,
      workerId: command.workerId,
      leaseDurationSeconds,
      claimToken,
    });

    if (!job) break;

    // If already in provider_attempt_started: outcome unknown from prior crash!
    // Never call non-idempotent provider twice automatically!
    if (job.phase === 'provider_attempt_started') {
      if (typeof deps.persistence.failSocialAccountRevocationJobAtomic === 'function') {
        await deps.persistence.failSocialAccountRevocationJobAtomic({
          jobId: job.id,
          leaseToken: job.leaseToken,
          workspaceId: job.workspaceId,
          accountId: job.socialAccountId,
          errorCode: 'OUTCOME_UNKNOWN',
          errorMessage:
            'Provider revocation outcome unknown after worker restart. Non-idempotent call will not be repeated.',
          now: deps.clock.now().toISOString(),
        });
      }
      processedCount++;
      failedCount++;
      continue;
    }

    const adapter = deps.adapters.get(job.platform);
    if (!adapter || !adapter.supportsRevocation || !adapter.revokeToken) {
      if (typeof deps.persistence.failSocialAccountRevocationJobAtomic === 'function') {
        await deps.persistence.failSocialAccountRevocationJobAtomic({
          jobId: job.id,
          leaseToken: job.leaseToken,
          workspaceId: job.workspaceId,
          accountId: job.socialAccountId,
          errorCode: 'PLATFORM_UNSUPPORTED',
          errorMessage: 'Platform or adapter does not support remote revocation.',
          now: deps.clock.now().toISOString(),
        });
      }
      processedCount++;
      failedCount++;
      continue;
    }

    // 1. Mark provider attempt started before external call
    if (typeof deps.persistence.markSocialAccountRevocationAttemptStarted === 'function') {
      await deps.persistence.markSocialAccountRevocationAttemptStarted({
        jobId: job.id,
        leaseToken: job.leaseToken,
        now: deps.clock.now().toISOString(),
      });
    }

    // 2. Decrypt staged token material
    let decryptedAccessToken: string;
    try {
      const decrypted = deps.protector.decrypt({
        workspaceId: job.workspaceId,
        socialAccountId: job.socialAccountId,
        platform: job.platform,
        credentials: {
          accessTokenCiphertext: job.encryptedToken,
          accessTokenIv: job.tokenIv,
          accessTokenAuthTag: job.tokenAuthTag,
          refreshTokenCiphertext: null,
          refreshTokenIv: null,
          refreshTokenAuthTag: null,
          keyVersion: job.encryptionKeyVersion,
        },
      });
      decryptedAccessToken = decrypted.accessToken;
    } catch {
      if (typeof deps.persistence.failSocialAccountRevocationJobAtomic === 'function') {
        await deps.persistence.failSocialAccountRevocationJobAtomic({
          jobId: job.id,
          leaseToken: job.leaseToken,
          workspaceId: job.workspaceId,
          accountId: job.socialAccountId,
          errorCode: 'CRYPTO_ERROR',
          errorMessage: 'Failed to decrypt staged token for revocation.',
          now: deps.clock.now().toISOString(),
        });
      }
      processedCount++;
      failedCount++;
      continue;
    }

    // 3. Call provider revocation OUTSIDE database transaction
    try {
      const res = await adapter.revokeToken(decryptedAccessToken);
      if (res.revoked) {
        if (typeof deps.persistence.completeSocialAccountRevocationJobAtomic === 'function') {
          await deps.persistence.completeSocialAccountRevocationJobAtomic({
            jobId: job.id,
            leaseToken: job.leaseToken,
            workspaceId: job.workspaceId,
            accountId: job.socialAccountId,
            now: deps.clock.now().toISOString(),
          });
        }
        succeededCount++;
      } else {
        if (typeof deps.persistence.failSocialAccountRevocationJobAtomic === 'function') {
          await deps.persistence.failSocialAccountRevocationJobAtomic({
            jobId: job.id,
            leaseToken: job.leaseToken,
            workspaceId: job.workspaceId,
            accountId: job.socialAccountId,
            errorCode: 'REVOKE_FAILED',
            errorMessage: 'Provider reported revocation was not completed.',
            now: deps.clock.now().toISOString(),
          });
        }
        failedCount++;
      }
    } catch (err: unknown) {
      const safeErr = classifyOperationSafeError(err);
      if (typeof deps.persistence.failSocialAccountRevocationJobAtomic === 'function') {
        await deps.persistence.failSocialAccountRevocationJobAtomic({
          jobId: job.id,
          leaseToken: job.leaseToken,
          workspaceId: job.workspaceId,
          accountId: job.socialAccountId,
          errorCode: safeErr.errorCode,
          errorMessage: safeErr.errorMessage,
          now: deps.clock.now().toISOString(),
        });
      }
      failedCount++;
    }
    processedCount++;
  }

  return { processedCount, succeededCount, failedCount };
}
