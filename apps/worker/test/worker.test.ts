import { describe, expect, it, vi } from 'vitest';
import { loadConfig, ConfigurationError, type AppConfig } from '@affiliate-content-os/config';
import { runWorker } from '../src/worker.js';
import { startWorker } from '../src/runner.js';

const mockConfig: AppConfig = Object.freeze({
  nodeEnv: 'test',
  logLevel: 'info',
  apiHost: '127.0.0.1',
  apiPort: 3001,
});

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

  it('operates in an idle state without periodic timer polling', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const controller = new AbortController();

    const workerPromise = runWorker({
      config: mockConfig,
      signal: controller.signal,
    });

    // Verify any interval registered is a non-polling keepalive (>= 1 hour) rather than periodic polling
    for (const call of setIntervalSpy.mock.calls) {
      const delay = call[1];
      if (typeof delay === 'number') {
        expect(delay).toBeGreaterThanOrEqual(3_600_000);
      }
    }

    controller.abort();
    await workerPromise;

    setIntervalSpy.mockRestore();
  });
});

describe('apps/worker - startWorker lifecycle', () => {
  it('rejects startup on invalid configuration before entering idle state', () => {
    expect(() => {
      loadConfig({ NODE_ENV: 'invalid' });
    }).toThrow(ConfigurationError);
  });

  it('installs and cleans up signal listeners during worker lifecycle', async () => {
    const initialSigint = process.listenerCount('SIGINT');
    const initialSigterm = process.listenerCount('SIGTERM');

    const controller = new AbortController();

    const workerPromise = startWorker({
      config: mockConfig,
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

  it('remains alive as an active process until stopped and exits cleanly', async () => {
    const { spawn } = await import('node:child_process');
    const path = await import('node:path');

    const workerDir = path.resolve(__dirname, '..');
    const workerScript = path.resolve(workerDir, 'src/main.ts');
    const child = spawn(process.execPath, ['--import', 'tsx', workerScript], {
      cwd: workerDir,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (d) => {
      output += d.toString();
    });
    child.stderr.on('data', (d) => {
      output += d.toString();
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Worker did not start in time: ${output}`)),
        5000,
      );
      const interval = setInterval(() => {
        if (output.includes('Worker process started and entering idle state')) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    // Verify it stays alive for at least 400ms (proving it does not exit prematurely after 253ms)
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(child.exitCode).toBeNull();
    expect(child.killed).toBe(false);

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );

    child.kill('SIGTERM');
    const exit = await exitPromise;

    expect(exit.code === 0 || exit.signal === 'SIGTERM').toBe(true);
  }, 10000);
});
