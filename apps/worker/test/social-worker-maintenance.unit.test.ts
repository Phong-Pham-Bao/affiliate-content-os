import { describe, expect, it, vi } from 'vitest';
import type { AppConfig, SocialConfig } from '@affiliate-content-os/config';
import type {
  SocialAuthAdapter,
  SocialCredentialProtectorPort,
  SocialPersistencePort,
} from '@affiliate-content-os/application';
import { runWorker } from '../src/worker.js';

describe('Worker Social Maintenance Runtime Wiring', () => {
  const baseConfig: AppConfig = Object.freeze({
    nodeEnv: 'test',
    logLevel: 'info',
    apiHost: '127.0.0.1',
    apiPort: 3001,
  });

  const baseSocialConfig = Object.freeze({
    enabled: true,
    socialKillSwitchActive: false,
    threadsRefreshKillSwitchActive: false,
    socialMaintenanceEnabled: true,
    threadsAppReviewStatus: 'development' as const,
    threadsHttpTimeoutMs: 15000,
  }) as unknown as SocialConfig;

  const createMockPersistence = (claimResult = null): SocialPersistencePort =>
    ({
      claimNextDueSocialAccountForRefresh: vi.fn().mockResolvedValue(claimResult),
      findSocialAccountById: vi.fn(),
      completeSocialAccountRefreshAtomic: vi.fn(),
      recordFailedSocialAccountRefreshAtomic: vi.fn(),
      releaseSocialAccountRefreshLeaseAtomic: vi.fn(),
    }) as unknown as SocialPersistencePort;

  const mockProtector: SocialCredentialProtectorPort = {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    encryptOAuthVerifier: vi.fn(),
    decryptOAuthVerifier: vi.fn(),
  };

  const mockAdapter: SocialAuthAdapter = {
    platform: 'threads',
    supportsRefresh: true,
    supportsRevocation: false,
    createAuthorizationUrl: vi.fn(),
    exchangeCode: vi.fn(),
    refreshToken: vi.fn(),
  };

  it('runs social maintenance when enabled, configured, and dependencies provided', async () => {
    const persistence = createMockPersistence();
    const abortController = new AbortController();

    await runWorker({
      config: baseConfig,
      socialConfig: baseSocialConfig,
      socialMaintenanceEnabled: true,
      socialPersistence: persistence,
      credentialProtector: mockProtector,
      socialAdapters: new Map([['threads', mockAdapter]]),
      signal: abortController.signal,
      once: true,
    });

    expect(persistence.claimNextDueSocialAccountForRefresh).toHaveBeenCalledTimes(1);
  });

  it('fails closed when social maintenance is disabled in config', async () => {
    const persistence = createMockPersistence();
    const abortController = new AbortController();

    const workerPromise = runWorker({
      config: baseConfig,
      socialConfig: { ...baseSocialConfig, socialMaintenanceEnabled: false },
      socialMaintenanceEnabled: false,
      socialPersistence: persistence,
      credentialProtector: mockProtector,
      socialAdapters: new Map([['threads', mockAdapter]]),
      signal: abortController.signal,
      once: true,
    });

    // When neither AI nor Maintenance can run, it enters idle handle without calling maintenance
    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();
    await workerPromise;

    expect(persistence.claimNextDueSocialAccountForRefresh).not.toHaveBeenCalled();
  });

  it('fails closed when global social kill switch is active', async () => {
    const persistence = createMockPersistence();
    const abortController = new AbortController();

    const workerPromise = runWorker({
      config: baseConfig,
      socialConfig: { ...baseSocialConfig, socialKillSwitchActive: true },
      socialMaintenanceEnabled: true,
      socialPersistence: persistence,
      credentialProtector: mockProtector,
      socialAdapters: new Map([['threads', mockAdapter]]),
      signal: abortController.signal,
      once: true,
    });

    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();
    await workerPromise;

    expect(persistence.claimNextDueSocialAccountForRefresh).not.toHaveBeenCalled();
  });

  it('fails closed when threads refresh kill switch is active', async () => {
    const persistence = createMockPersistence();
    const abortController = new AbortController();

    const workerPromise = runWorker({
      config: baseConfig,
      socialConfig: { ...baseSocialConfig, threadsRefreshKillSwitchActive: true },
      socialMaintenanceEnabled: true,
      socialPersistence: persistence,
      credentialProtector: mockProtector,
      socialAdapters: new Map([['threads', mockAdapter]]),
      signal: abortController.signal,
      once: true,
    });

    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();
    await workerPromise;

    expect(persistence.claimNextDueSocialAccountForRefresh).not.toHaveBeenCalled();
  });

  it('fails closed when socialPersistence port is missing', async () => {
    const abortController = new AbortController();

    const workerPromise = runWorker({
      config: baseConfig,
      socialConfig: baseSocialConfig,
      socialMaintenanceEnabled: true,
      credentialProtector: mockProtector,
      socialAdapters: new Map([['threads', mockAdapter]]),
      signal: abortController.signal,
      once: true,
    });

    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();
    await workerPromise;
  });

  it('fails closed when credentialProtector is missing', async () => {
    const persistence = createMockPersistence();
    const abortController = new AbortController();

    const workerPromise = runWorker({
      config: baseConfig,
      socialConfig: baseSocialConfig,
      socialMaintenanceEnabled: true,
      socialPersistence: persistence,
      socialAdapters: new Map([['threads', mockAdapter]]),
      signal: abortController.signal,
      once: true,
    });

    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();
    await workerPromise;

    expect(persistence.claimNextDueSocialAccountForRefresh).not.toHaveBeenCalled();
  });

  it('fails closed when socialAdapters map is missing', async () => {
    const persistence = createMockPersistence();
    const abortController = new AbortController();

    const workerPromise = runWorker({
      config: baseConfig,
      socialConfig: baseSocialConfig,
      socialMaintenanceEnabled: true,
      socialPersistence: persistence,
      credentialProtector: mockProtector,
      signal: abortController.signal,
      once: true,
    });

    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();
    await workerPromise;

    expect(persistence.claimNextDueSocialAccountForRefresh).not.toHaveBeenCalled();
  });
});
