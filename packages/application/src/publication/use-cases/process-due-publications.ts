import crypto from 'node:crypto';
import {
  calculatePublicationBackoff,
  dateToIsoTimestamp,
  type IsoTimestamp,
  type PublicationOutcome,
} from '@affiliate-content-os/domain';
import type { PublicationPersistencePort, SocialPublicationAdapter } from '../ports.js';

export interface ProcessDuePublicationsCommand {
  readonly workerId: string;
  readonly maxBatchSize?: number | undefined;
  readonly leaseDurationSeconds?: number | undefined;
}

export interface ProcessDuePublicationsDependencies {
  readonly persistence: PublicationPersistencePort;
  readonly adapter: SocialPublicationAdapter;
  readonly enabled: boolean;
  readonly publishKillSwitchActive?: boolean | undefined;
  readonly adapterTimeoutMs?: number | undefined;
  readonly adapterVersion?: string | undefined;
  readonly clock?: { now(): Date } | undefined;
}

export interface ProcessDuePublicationsResult {
  readonly processedCount: number;
  readonly recoveredCount: number;
}

async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function processDuePublications(
  command: ProcessDuePublicationsCommand,
  deps: ProcessDuePublicationsDependencies,
): Promise<ProcessDuePublicationsResult> {
  if (!deps.enabled || deps.publishKillSwitchActive) {
    return { processedCount: 0, recoveredCount: 0 };
  }

  const workerId = command.workerId;
  const maxBatchSize = command.maxBatchSize ?? 5;
  const leaseDurationSeconds = command.leaseDurationSeconds ?? 30;
  const adapterTimeoutMs = Math.min(
    deps.adapterTimeoutMs ?? 10_000,
    Math.max(1000, (leaseDurationSeconds - 2) * 1000),
  );
  const adapterVersion = deps.adapterVersion ?? 'fake-v1';
  const getNow = deps.clock?.now ?? (() => new Date());

  // 1. Claim due rows
  const claimed = await deps.persistence.claimDuePublications({
    workerId,
    maxBatchSize,
    leaseDurationSeconds,
  });

  let processedCount = 0;

  for (const item of claimed) {
    const correlationId = crypto.randomUUID();

    // 2. Prepare attempt and revalidate in preparation transaction
    let prepared;
    try {
      prepared = await deps.persistence.prepareAttemptTransaction({
        workspaceId: item.publication.workspaceId,
        publicationId: item.publication.id,
        leaseToken: item.leaseToken,
        workerId,
        correlationId,
        adapterVersion,
      });
    } catch {
      continue;
    }

    if (prepared.kind === 'gated_drift') {
      processedCount++;
      continue;
    }

    // 3. Provider call executed OUTSIDE DB transactions
    let outcome: PublicationOutcome;
    try {
      outcome = await executeWithTimeout(
        deps.adapter.publishText({
          workspaceId: item.publication.workspaceId,
          publicationId: item.publication.id,
          attemptId: prepared.attemptId,
          attemptNumber: prepared.attemptNumber,
          attemptIdempotencyKey: prepared.attemptIdempotencyKey,
          socialAccountId: prepared.socialAccountId,
          providerAccountId: prepared.providerAccountId,
          renderedText: prepared.renderedText,
          platformSettings: prepared.platformSettings,
          correlationId,
          accessToken: prepared.decryptedAccessToken,
        }),
        adapterTimeoutMs,
        'Publication adapter call timed out after possible provider acceptance',
      );
    } catch (err: unknown) {
      outcome = {
        kind: 'outcome_unknown',
        errorCode: 'ADAPTER_TIMEOUT_OR_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown adapter execution failure',
      };
    }

    // 4. Settle attempt and publication atomically with CAS
    let nextAttemptAt: IsoTimestamp | undefined;
    if (outcome.kind === 'transient_failure') {
      const backoffMs = calculatePublicationBackoff(prepared.attemptNumber, outcome.retryAfterMs);
      nextAttemptAt = dateToIsoTimestamp(new Date(getNow().getTime() + backoffMs));
    }

    try {
      await deps.persistence.settleAttemptTransaction({
        workspaceId: item.publication.workspaceId,
        publicationId: item.publication.id,
        leaseToken: item.leaseToken,
        attemptId: prepared.attemptId,
        attemptNumber: prepared.attemptNumber,
        outcome,
        nextAttemptAt,
      });
      processedCount++;
    } catch {
      // CAS fence-lost or settlement failure
    }
  }

  // 5. Recover expired leases
  let recoveredCount = 0;
  try {
    const recovery = await deps.persistence.recoverExpiredLeases({
      workerId,
      leaseDurationSeconds,
    });
    recoveredCount = recovery.reclaimedCount + recovery.markedUnknownCount;
  } catch {
    // continue
  }

  return { processedCount, recoveredCount };
}
