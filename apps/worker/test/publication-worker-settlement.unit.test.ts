import { describe, expect, it, vi } from 'vitest';
import { FakeSocialPublicationAdapter } from '@affiliate-content-os/infrastructure/publication';
import type { SocialPublicationAdapter } from '@affiliate-content-os/application';
import { runWorker } from '../src/worker.js';
import {
  baseWorkerAppConfig,
  baseWorkerSocialConfig,
  createInMemoryPublicationPersistencePort,
  sampleClaimedPublication,
  samplePublication,
} from './helpers/publication-worker-fixtures.js';

describe('Worker Publication Settlement and Outcomes', () => {
  it('settles confirmed published success with remote post ID and permalink', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
    });
    const adapter = new FakeSocialPublicationAdapter({ defaultBehavior: 'published' });
    const abortController = new AbortController();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: adapter,
      signal: abortController.signal,
      once: true,
    });

    expect(persistenceState.claimCalls.length).toBe(1);
    expect(adapter.getTotalCallCount()).toBe(1);
    expect(persistenceState.settledAttempts.length).toBe(1);

    const settled = persistenceState.settledAttempts[0]!;
    expect(settled.outcome.kind).toBe('published');
    if (settled.outcome.kind === 'published') {
      expect(settled.outcome.remotePostId).toMatch(/^fake_threads_post_[a-f0-9]{16}$/);
      expect(settled.outcome.remotePermalink).toMatch(/^https:\/\/threads\.net\//);
      expect(settled.outcome.publishedAt).toBeDefined();
    }
    expect(settled.nextAttemptAt).toBeUndefined();
  });

  it('settles transient failure with calculated nextAttemptAt backoff', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
    });
    const adapter = new FakeSocialPublicationAdapter({ defaultBehavior: 'transient' });
    const abortController = new AbortController();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: adapter,
      signal: abortController.signal,
      once: true,
    });

    expect(persistenceState.settledAttempts.length).toBe(1);
    const settled = persistenceState.settledAttempts[0]!;
    expect(settled.outcome.kind).toBe('transient_failure');
    expect(settled.nextAttemptAt).toBeDefined();
  });

  it('settles rate-limit failure with RATE_LIMIT_EXCEEDED and nextAttemptAt', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
    });
    const adapter = new FakeSocialPublicationAdapter({ defaultBehavior: 'rate_limited' });
    const abortController = new AbortController();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: adapter,
      signal: abortController.signal,
      once: true,
    });

    expect(persistenceState.settledAttempts.length).toBe(1);
    const settled = persistenceState.settledAttempts[0]!;
    expect(settled.outcome.kind).toBe('transient_failure');
    if (settled.outcome.kind === 'transient_failure') {
      expect(settled.outcome.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    }
    expect(settled.nextAttemptAt).toBeDefined();
  });

  it('settles permanent rejection with rejected outcome and no nextAttemptAt', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
    });
    const adapter = new FakeSocialPublicationAdapter({ defaultBehavior: 'permanent_rejected' });
    const abortController = new AbortController();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: adapter,
      signal: abortController.signal,
      once: true,
    });

    expect(persistenceState.settledAttempts.length).toBe(1);
    const settled = persistenceState.settledAttempts[0]!;
    expect(settled.outcome.kind).toBe('permanent_failure');
    if (settled.outcome.kind === 'permanent_failure') {
      expect(settled.outcome.errorCode).toBe('CONTENT_POLICY_VIOLATION');
    }
    expect(settled.nextAttemptAt).toBeUndefined();
  });

  it('settles outcome_unknown when adapter throws an error', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
    });
    const failingAdapter: SocialPublicationAdapter = {
      publishText: vi.fn().mockRejectedValue(new Error('Simulated network connection drop')),
    };
    const abortController = new AbortController();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: failingAdapter,
      signal: abortController.signal,
      once: true,
    });

    expect(persistenceState.settledAttempts.length).toBe(1);
    const settled = persistenceState.settledAttempts[0]!;
    expect(settled.outcome.kind).toBe('outcome_unknown');
    if (settled.outcome.kind === 'outcome_unknown') {
      expect(settled.outcome.errorCode).toBe('ADAPTER_TIMEOUT_OR_ERROR');
      expect(settled.outcome.errorMessage).toContain('Simulated network connection drop');
    }
  });

  it('settles outcome_unknown when adapter times out', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
    });
    const hangingAdapter = new FakeSocialPublicationAdapter({
      defaultBehavior: 'timeout_hang',
      hangTimeoutMs: 30,
    });
    const abortController = new AbortController();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: hangingAdapter,
      signal: abortController.signal,
      once: true,
    });

    expect(persistenceState.settledAttempts.length).toBe(1);
    const settled = persistenceState.settledAttempts[0]!;
    expect(settled.outcome.kind).toBe('outcome_unknown');
  });

  it('aborts provider call when gated_drift is encountered during preparation', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
      prepareResult: {
        kind: 'gated_drift',
        reason: 'capability_scope_revoked',
        errorCode: 'SCOPE_REVOKED',
        errorMessage: 'Destination account lost publish permission',
      },
    });
    const adapter = new FakeSocialPublicationAdapter();
    const abortController = new AbortController();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: adapter,
      signal: abortController.signal,
      once: true,
    });

    expect(persistenceState.claimCalls.length).toBe(1);
    expect(persistenceState.prepareCalls.length).toBe(1);
    expect(adapter.getTotalCallCount()).toBe(0);
    expect(persistenceState.settledAttempts.length).toBe(0);
  });

  it('observes stable call counts and idempotent remote posts on duplicate claims', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication, sampleClaimedPublication],
    });
    const adapter = new FakeSocialPublicationAdapter();
    const abortController = new AbortController();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: adapter,
      signal: abortController.signal,
      once: true,
    });

    expect(adapter.getTotalCallCount()).toBe(2);
    expect(adapter.getCallCountForPublication(samplePublication.id)).toBe(2);
    expect(persistenceState.settledAttempts.length).toBe(2);

    const first = persistenceState.settledAttempts[0]!.outcome;
    const second = persistenceState.settledAttempts[1]!.outcome;
    expect(first.kind).toBe('published');
    expect(second.kind).toBe('published');
    if (first.kind === 'published' && second.kind === 'published') {
      expect(first.remotePostId).toBe(second.remotePostId);
      expect(first.remotePermalink).toBe(second.remotePermalink);
    }
  });
});
