import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Database } from '@affiliate-content-os/infrastructure/database';
import {
  FakeSocialPublicationAdapter,
  FakePublicationProductionSelectionError,
  resolveSocialPublicationAdapter,
} from '@affiliate-content-os/infrastructure/publication';
import { startWorker } from '../src/runner.js';
import type { WorkerDependencies } from '../src/worker.js';
import {
  baseWorkerAppConfig,
  baseWorkerSocialConfig,
  createInMemoryPublicationPersistencePort,
} from './helpers/publication-worker-fixtures.js';

describe('Worker Publication Composition and Runner Forwarding', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('forwards publicationPersistence and publicationAdapter dependencies from startWorker to worker loop', async () => {
    const persistenceState = createInMemoryPublicationPersistencePort();
    const adapter = new FakeSocialPublicationAdapter();
    const abortController = new AbortController();

    const mockDb: Database = {
      probe: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [], rowCount: 0, command: 'SELECT' })),
      withTransaction: vi.fn(async (fn) =>
        fn({
          query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT' }),
        }),
      ),
      isClosing: vi.fn(() => false),
    };

    let forwardedDeps: WorkerDependencies | undefined;
    const workerRunnerSpy = vi.fn(async (deps: WorkerDependencies) => {
      forwardedDeps = deps;
    });

    await startWorker({
      config: baseWorkerAppConfig,
      socialConfig: baseWorkerSocialConfig,
      publicationPersistence: persistenceState.port,
      publicationAdapter: adapter,
      database: mockDb,
      abortController,
      installSignalHandlers: false,
      workerRunner: workerRunnerSpy,
    });

    expect(workerRunnerSpy).toHaveBeenCalledTimes(1);
    expect(forwardedDeps?.publicationPersistence).toBe(persistenceState.port);
    expect(forwardedDeps?.publicationAdapter).toBe(adapter);
  });

  it('strictly rejects selecting fake publication adapter in production environment', () => {
    expect(() =>
      resolveSocialPublicationAdapter({
        fakeAdapterEnabled: true,
        environment: 'production',
      }),
    ).toThrow(FakePublicationProductionSelectionError);

    process.env['NODE_ENV'] = 'production';
    expect(() =>
      resolveSocialPublicationAdapter({
        fakeAdapterEnabled: true,
      }),
    ).toThrow(FakePublicationProductionSelectionError);

    expect(() => new FakeSocialPublicationAdapter()).toThrow(
      FakePublicationProductionSelectionError,
    );
  });

  it('fails closed when fake adapter is disabled and live adapters not yet available', () => {
    expect(() =>
      resolveSocialPublicationAdapter({
        fakeAdapterEnabled: false,
        environment: 'local',
      }),
    ).toThrow('No social publication adapter available');
  });

  it('proves apps/worker/src/main.ts guards fake publication adapter selection with non-production check', () => {
    const mainPath = path.resolve(process.cwd(), 'apps/worker/src/main.ts');
    const mainCode = fs.readFileSync(mainPath, 'utf8');

    expect(mainCode).toContain("config.nodeEnv !== 'production'");
    expect(mainCode).toContain('resolveSocialPublicationAdapter');
    expect(mainCode).toContain('publicationPersistence');
    expect(mainCode).toContain('publicationAdapter');
  });
});
