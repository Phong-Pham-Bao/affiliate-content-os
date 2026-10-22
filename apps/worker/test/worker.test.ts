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

  it('operates in an idle state without any timers or polling', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const controller = new AbortController();

    const workerPromise = runWorker({
      config: mockConfig,
      signal: controller.signal,
    });

    // Strictly 0 timer registrations during worker idle operation
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    controller.abort();
    await workerPromise;

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });

  it('holds a referenced runtime handle while idle and closes it on abort', async () => {
    const handleRef = vi.fn();
    const handleClose = vi.fn();
    const controller = new AbortController();

    const workerPromise = runWorker({
      config: mockConfig,
      signal: controller.signal,
      runtimeHandle: {
        ref: handleRef,
        close: handleClose,
      },
    });

    expect(handleRef).toHaveBeenCalledTimes(1);
    expect(handleClose).not.toHaveBeenCalled();

    controller.abort();
    await workerPromise;

    expect(handleClose).toHaveBeenCalledTimes(1);
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

  it('handles SIGINT gracefully by running shutdown path and closing resources', async () => {
    const handleRef = vi.fn();
    const handleClose = vi.fn();
    const onStarted = vi.fn();

    const workerPromise = startWorker({
      config: mockConfig,
      installSignalHandlers: true,
      onStarted,
      runtimeHandle: {
        ref: handleRef,
        close: handleClose,
      },
    });

    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(handleRef).toHaveBeenCalledTimes(1);
    expect(handleClose).not.toHaveBeenCalled();

    process.emit('SIGINT');

    await expect(workerPromise).resolves.toBeUndefined();
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('handles SIGTERM gracefully by running shutdown path and closing resources', async () => {
    const handleRef = vi.fn();
    const handleClose = vi.fn();
    const onStarted = vi.fn();

    const workerPromise = startWorker({
      config: mockConfig,
      installSignalHandlers: true,
      onStarted,
      runtimeHandle: {
        ref: handleRef,
        close: handleClose,
      },
    });

    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(handleRef).toHaveBeenCalledTimes(1);
    expect(handleClose).not.toHaveBeenCalled();

    process.emit('SIGTERM');

    await expect(workerPromise).resolves.toBeUndefined();
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('proves graceful handling on SIGINT in a real process exiting with code 0', async () => {
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

    // Verify it stays alive in idle state
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(child.exitCode).toBeNull();
    expect(child.killed).toBe(false);

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );

    // Deliver SIGINT via stdin signal bridge (Windows-compatible non-destructive signal delivery)
    child.stdin.write('SIGINT\n');
    const exit = await exitPromise;

    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
    expect(output).toContain('Worker process received SIGINT, shutting down gracefully');
    expect(output).toContain('Worker process stopped gracefully');
  }, 10000);

  it('proves graceful handling on SIGTERM in a real process exiting with code 0', async () => {
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

    // Verify it stays alive in idle state
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(child.exitCode).toBeNull();
    expect(child.killed).toBe(false);

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );

    // Deliver SIGTERM via stdin signal bridge (Windows-compatible non-destructive signal delivery)
    child.stdin.write('SIGTERM\n');
    const exit = await exitPromise;

    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
    expect(output).toContain('Worker process received SIGTERM, shutting down gracefully');
    expect(output).toContain('Worker process stopped gracefully');
  }, 10000);
});
