import { describe, expect, it, vi } from 'vitest';
import { FakeSocialPublicationAdapter } from '@affiliate-content-os/infrastructure/publication';
import { runWorker } from '../src/worker.js';
import {
  baseWorkerAppConfig,
  baseWorkerSocialConfig,
  createInMemoryPublicationPersistencePort,
  sampleClaimedPublication,
} from './helpers/publication-worker-fixtures.js';

describe('Worker Publication Lifecycle and Safety', () => {
  it('fails closed to idle when no publication adapter is configured', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort();
    const abortController = new AbortController();

    const workerPromise = runWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: undefined,
      signal: abortController.signal,
      once: true,
    });

    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();
    await workerPromise;

    expect(persistenceState.claimCalls.length).toBe(0);
  });

  it('fails closed when socialConfig is disabled or kill switches active', async () => {
    const adapter = new FakeSocialPublicationAdapter();

    // 1. socialConfig.enabled is false
    const stateDisabled = createInMemoryPublicationPersistencePort();
    const ctrl1 = new AbortController();
    const p1 = runWorker({
      config: baseWorkerAppConfig,
      socialConfig: { ...baseWorkerSocialConfig, enabled: false },
      publicationPersistence: stateDisabled.port,
      publicationAdapter: adapter,
      signal: ctrl1.signal,
      once: true,
    });
    await new Promise((r) => setTimeout(r, 30));
    ctrl1.abort();
    await p1;
    expect(stateDisabled.claimCalls.length).toBe(0);

    // 2. global socialKillSwitchActive is true
    const stateGlobalKill = createInMemoryPublicationPersistencePort();
    const ctrl2 = new AbortController();
    const p2 = runWorker({
      config: baseWorkerAppConfig,
      socialConfig: { ...baseWorkerSocialConfig, socialKillSwitchActive: true },
      publicationPersistence: stateGlobalKill.port,
      publicationAdapter: adapter,
      signal: ctrl2.signal,
      once: true,
    });
    await new Promise((r) => setTimeout(r, 30));
    ctrl2.abort();
    await p2;
    expect(stateGlobalKill.claimCalls.length).toBe(0);

    // 3. platform threadsPublishKillSwitchActive is true
    const statePlatformKill = createInMemoryPublicationPersistencePort();
    const ctrl3 = new AbortController();
    const p3 = runWorker({
      config: baseWorkerAppConfig,
      socialConfig: { ...baseWorkerSocialConfig, threadsPublishKillSwitchActive: true },
      publicationPersistence: statePlatformKill.port,
      publicationAdapter: adapter,
      signal: ctrl3.signal,
      once: true,
    });
    await new Promise((r) => setTimeout(r, 30));
    ctrl3.abort();
    await p3;
    expect(statePlatformKill.claimCalls.length).toBe(0);
    expect(adapter.getTotalCallCount()).toBe(0);
  });

  it('completes cleanly when no due work is returned', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [],
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
    expect(persistenceState.prepareCalls.length).toBe(0);
    expect(adapter.getTotalCallCount()).toBe(0);
    expect(persistenceState.settledAttempts.length).toBe(0);
    expect(persistenceState.recoveryCalls.length).toBe(1);
  });

  it('invokes recoverExpiredLeases during execution', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      recoveryResult: { reclaimedCount: 3, markedUnknownCount: 2 },
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

    expect(persistenceState.recoveryCalls.length).toBe(1);
    expect(persistenceState.recoveryCalls[0]!.leaseDurationSeconds).toBe(
      baseWorkerSocialConfig.publicationWorkerLeaseDurationSeconds,
    );
  });

  it('safely handles stale settlement CAS fence error without crashing', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
      onSettleAttempt: () => {
        throw new Error('CAS fence lost: attempt already settled or lease expired');
      },
    });
    const adapter = new FakeSocialPublicationAdapter();
    const abortController = new AbortController();

    await expect(
      runWorker({
        config: baseWorkerAppConfig,
        socialConfig: baseWorkerSocialConfig,
        publicationPersistence: persistenceState.port,
        publicationAdapter: adapter,
        signal: abortController.signal,
        once: true,
      }),
    ).resolves.toBeUndefined();

    expect(persistenceState.settledAttempts.length).toBe(1);
    expect(persistenceState.recoveryCalls.length).toBe(1);
  });

  it('verifies publication processedCount affects hadWork state in worker loop', async () => {
    let callCount = 0;
    const abortController = new AbortController();
    const persistenceState = createInMemoryPublicationPersistencePort({
      claimedItems: [sampleClaimedPublication],
      onClaimDuePublications: () => {
        callCount++;
      },
      onSettleAttempt: () => {
        // Settle succeeds, incrementing processedCount and setting hadWork = true
        // Abort now so worker loop terminates after this iteration
        abortController.abort();
      },
    });
    const adapter = new FakeSocialPublicationAdapter();

    await runWorker({
      config: baseWorkerAppConfig,
      socialConfig: {
        ...baseWorkerSocialConfig,
        publicationWorkerPollingIntervalMs: 500,
      },
      publicationPersistence: persistenceState.port,
      publicationAdapter: adapter,
      signal: abortController.signal,
    });

    expect(callCount).toBe(1);
    expect(adapter.getTotalCallCount()).toBe(1);
    expect(persistenceState.settledAttempts.length).toBe(1);
  });

  it('logs structured error containing only safe errorName without message, token, or request payload', async () => {
    const secretToken = 'SECRET_OAUTH_TOKEN_threads_12345';
    const secretPayload = '{"app_secret":"super_secret_value","request_body":"deal"}';
    const sensitiveError = new Error(
      `Network error Bearer ${secretToken} when sending request payload ${secretPayload}`,
    );

    const persistenceState = createInMemoryPublicationPersistencePort({
      onClaimDuePublications: () => {
        throw sensitiveError;
      },
    });
    const adapter = new FakeSocialPublicationAdapter();
    const abortController = new AbortController();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await runWorker({
        config: baseWorkerAppConfig,
        socialConfig: baseWorkerSocialConfig,
        publicationPersistence: persistenceState.port,
        publicationAdapter: adapter,
        signal: abortController.signal,
        once: true,
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const rawLogged = consoleErrorSpy.mock.calls[0]![0];
      expect(typeof rawLogged).toBe('string');
      const parsed = JSON.parse(rawLogged as string);

      expect(parsed.level).toBe('error');
      expect(parsed.event).toBe('worker.publication_failure');
      expect(parsed.workerId).toBeDefined();
      expect(parsed.errorName).toBe('Error');
      expect(parsed.timestamp).toBeDefined();

      expect(parsed).not.toHaveProperty('message');
      expect(parsed).not.toHaveProperty('token');
      expect(parsed).not.toHaveProperty('request');
      expect(rawLogged).not.toContain(secretToken);
      expect(rawLogged).not.toContain('super_secret_value');
      expect(rawLogged).not.toContain('Bearer');
      expect(rawLogged).not.toContain('request payload');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
