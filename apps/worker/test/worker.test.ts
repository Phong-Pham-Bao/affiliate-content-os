import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError, type AppConfig } from '@affiliate-content-os/config';
import { runWorker } from '../src/worker.js';
import { startWorker } from '../src/runner.js';

const mockConfig: AppConfig = {
  nodeEnv: 'test',
  logLevel: 'info',
  apiHost: '127.0.0.1',
  apiPort: 3001,
};

describe('apps/worker - runWorker', () => {
  it('signals that startup completed through onStarted callback', async () => {
    const controller = new AbortController();
    const onStarted = vi.fn();

    const workerPromise = runWorker({
      config: mockConfig,
      signal: controller.signal,
      onStarted,
    });

    expect(onStarted).toHaveBeenCalledTimes(1);

    controller.abort();
    await workerPromise;
  });

  it('enters an idle state without completing until aborted', async () => {
    const controller = new AbortController();
    let isSettled = false;

    const workerPromise = runWorker({
      config: mockConfig,
      signal: controller.signal,
    }).then(() => {
      isSettled = true;
    });

    // Worker remains pending while idle
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(isSettled).toBe(false);

    controller.abort();
    await workerPromise;
    expect(isSettled).toBe(true);
  });

  it('exits immediately when signal is already aborted before startup', async () => {
    const controller = new AbortController();
    controller.abort();

    const onStarted = vi.fn();

    await runWorker({
      config: mockConfig,
      signal: controller.signal,
      onStarted,
    });

    expect(onStarted).not.toHaveBeenCalled();
  });

  it('handles repeated abort calls idempotently without error', async () => {
    const controller = new AbortController();

    const workerPromise = runWorker({
      config: mockConfig,
      signal: controller.signal,
    });

    controller.abort();
    controller.abort();
    controller.abort();

    await expect(workerPromise).resolves.toBeUndefined();
  });

  it('operates without setting periodic intervals or timer polling', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const controller = new AbortController();

    const workerPromise = runWorker({
      config: mockConfig,
      signal: controller.signal,
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();

    controller.abort();
    await workerPromise;

    setIntervalSpy.mockRestore();
  });
});

describe('apps/worker - startWorker lifecycle', () => {
  it('rejects startup on invalid configuration without entering idle state', async () => {
    await expect(
      startWorker({
        rawEnv: { NODE_ENV: 'invalid' },
        installSignalHandlers: false,
      }),
    ).rejects.toThrow(ConfigurationError);
  });

  it('installs and cleans up signal listeners during worker lifecycle', async () => {
    const initialSigint = process.listenerCount('SIGINT');
    const initialSigterm = process.listenerCount('SIGTERM');

    const controller = new AbortController();

    const workerPromise = startWorker({
      rawEnv: { NODE_ENV: 'test' },
      abortController: controller,
      installSignalHandlers: true,
    });

    expect(process.listenerCount('SIGINT')).toBe(initialSigint + 1);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigterm + 1);

    controller.abort();
    await workerPromise;

    expect(process.listenerCount('SIGINT')).toBe(initialSigint);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigterm);
  });
});
