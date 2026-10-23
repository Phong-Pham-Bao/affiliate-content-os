import { describe, expect, it, vi } from 'vitest';
import { loadConfig, ConfigurationError, type AppConfig } from '@affiliate-content-os/config';
import type { Database } from '@affiliate-content-os/infrastructure/database';
import { runWorker } from '../src/worker.js';
import { startWorker } from '../src/runner.js';

const mockConfig: AppConfig = Object.freeze({
  nodeEnv: 'test',
  logLevel: 'info',
  apiHost: '127.0.0.1',
  apiPort: 3001,
});

function createMockDatabase(overrides?: Partial<Database>): Database {
  return {
    probe: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    query: vi.fn(async () => ({ rows: [], rowCount: 0, command: 'SELECT' })),
    withTransaction: vi.fn(async (fn) =>
      fn({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT' }),
      }),
    ),
    isClosing: vi.fn(() => false),
    ...overrides,
  };
}

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
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const controller = new AbortController();
    const workerPromise = runWorker({
      config: mockConfig,
      signal: controller.signal,
    });

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    controller.abort();
    await workerPromise;

    setTimeoutSpy.mockRestore();
    setIntervalSpy.mockRestore();
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

  it('probes database connection and fails cleanly when probe rejects', async () => {
    const mockDb = createMockDatabase({
      probe: vi.fn().mockRejectedValueOnce(new Error('Connection refused')),
    });
    const terminateSpy = vi.fn();

    await expect(
      startWorker({
        config: mockConfig,
        database: mockDb,
        installSignalHandlers: false,
        terminate: terminateSpy,
      }),
    ).rejects.toThrow('Connection refused');

    expect(mockDb.close).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledWith(1);
  });

  it('shares single shutdown deadline across worker runtime settlement and pool close with injected timers', async () => {
    let fakeTime = 1000;
    const now = () => fakeTime;
    const executionOrder: string[] = [];

    const timers: { id: number; fn: () => void }[] = [];
    let timerSeq = 0;
    const setTimer = (fn: () => void) => {
      const id = ++timerSeq;
      timers.push({ id, fn });
      return id;
    };
    const clearTimer = (id: unknown) => {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx !== -1) {
        timers.splice(idx, 1);
      }
    };

    const mockDb = createMockDatabase({
      close: vi.fn(async () => {
        executionOrder.push('pool.close');
        fakeTime += 1500;
      }),
    });

    const controller = new AbortController();
    let runnerStartedResolve!: () => void;
    const runnerStartedPromise = new Promise<void>((resolve) => {
      runnerStartedResolve = resolve;
    });

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      abortController: controller,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      installSignalHandlers: false,
      workerRunner: async ({ signal }) => {
        executionOrder.push('runtime.start');
        runnerStartedResolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            executionOrder.push('runtime.settle');
            fakeTime += 2000;
            resolve();
            return;
          }
          signal.addEventListener('abort', () => {
            executionOrder.push('runtime.settle');
            fakeTime += 2000;
            resolve();
          });
        });
      },
    });

    await runnerStartedPromise;
    controller.abort();
    await expect(workerPromise).resolves.toBeUndefined();

    // Verify ordering: runtime settlement happens before pool close!
    expect(executionOrder).toEqual(['runtime.start', 'runtime.settle', 'pool.close']);
    expect(fakeTime).toBe(4500); // 1000 + 2000 + 1500 <= 5000ms deadline
    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });

  it('triggers forced exit code 1 when worker runtime settlement times out', async () => {
    let fakeTime = 1000;
    const now = () => fakeTime;
    const terminateSpy = vi.fn();

    const timers: { id: number; fn: () => void }[] = [];
    let timerSeq = 0;
    const setTimer = (fn: () => void) => {
      const id = ++timerSeq;
      timers.push({ id, fn });
      return id;
    };
    const clearTimer = (id: unknown) => {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx !== -1) {
        timers.splice(idx, 1);
      }
    };

    const mockDb = createMockDatabase();
    const controller = new AbortController();
    let runnerStartedResolve!: () => void;
    const runnerStartedPromise = new Promise<void>((resolve) => {
      runnerStartedResolve = resolve;
    });

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      abortController: controller,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      terminate: terminateSpy,
      installSignalHandlers: false,
      workerRunner: async ({ signal }) => {
        runnerStartedResolve();
        return new Promise<void>(() => {
          const onAbort = () => {
            // Runtime settlement hangs indefinitely; trigger timer
            fakeTime += 6000;
            queueMicrotask(() => {
              const timer = timers.shift();
              timer?.fn();
            });
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort);
          }
        });
      },
    });

    await runnerStartedPromise;
    controller.abort();
    await expect(workerPromise).rejects.toThrow(/timed out/);
    expect(terminateSpy).toHaveBeenCalledWith(1);
  });

  it('triggers forced exit code 1 when database close times out during shutdown', async () => {
    let fakeTime = 1000;
    const now = () => fakeTime;
    const terminateSpy = vi.fn();

    const timers: { id: number; fn: () => void }[] = [];
    let timerSeq = 0;
    const setTimer = (fn: () => void) => {
      const id = ++timerSeq;
      timers.push({ id, fn });
      return id;
    };
    const clearTimer = (id: unknown) => {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx !== -1) {
        timers.splice(idx, 1);
      }
    };

    const mockDb = createMockDatabase({
      close: vi.fn((() => {
        // Pool close hangs; trigger timer
        fakeTime += 3000;
        queueMicrotask(() => {
          const timer = timers.shift();
          timer?.fn();
        });
        return new Promise<void>(() => {});
      }) as never),
    });

    const controller = new AbortController();
    let runnerStartedResolve!: () => void;
    const runnerStartedPromise = new Promise<void>((resolve) => {
      runnerStartedResolve = resolve;
    });

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      abortController: controller,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      terminate: terminateSpy,
      installSignalHandlers: false,
      workerRunner: async ({ signal }) => {
        runnerStartedResolve();
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            fakeTime += 3000; // Runtime settlement takes 3000ms out of 5000ms
            resolve();
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort);
          }
        });
      },
    });

    await runnerStartedPromise;
    controller.abort();
    await expect(workerPromise).rejects.toThrow(/timed out/);
    expect(terminateSpy).toHaveBeenCalledWith(1);
  });

  it('forces exit code 1 when pool close hangs until deadline during probe abort', async () => {
    let fakeTime = 1000;
    const now = () => fakeTime;
    const terminateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const timers: { id: number; fn: () => void }[] = [];
    let timerSeq = 0;
    const setTimer = (fn: () => void) => {
      const id = ++timerSeq;
      timers.push({ id, fn });
      return id;
    };
    const clearTimer = (id: unknown) => {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx !== -1) {
        timers.splice(idx, 1);
      }
    };

    const controller = new AbortController();

    const mockDb = createMockDatabase({
      probe: vi.fn(async (signal?: AbortSignal) => {
        if (signal?.aborted) {
          throw new Error('Probe aborted');
        }
        return new Promise<void>((_, rej) => {
          signal?.addEventListener('abort', () => rej(new Error('Probe aborted')));
        });
      }),
      close: vi.fn((() => {
        // Pool close hangs; advance time past 5000ms deadline and trigger timer
        fakeTime += 6000;
        queueMicrotask(() => {
          const timer = timers.shift();
          timer?.fn();
        });
        return new Promise<void>(() => {});
      }) as never),
    });

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      abortController: controller,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      terminate: terminateSpy,
      installSignalHandlers: false,
    });

    // Abort controller while probe is pending
    controller.abort();

    await expect(workerPromise).rejects.toThrow(/Worker startup cleanup timed out/);
    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledWith(1);
    expect(terminateSpy).not.toHaveBeenCalledWith(0);

    const errorLogs = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errorLogs).toContain(
      'Worker startup cleanup failure: Worker startup cleanup timed out after 5000ms',
    );

    consoleErrorSpy.mockRestore();
  });

  it('forces exit code 1 when pool close rejects during probe abort', async () => {
    const terminateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const controller = new AbortController();
    const mockDb = createMockDatabase({
      probe: vi.fn(async (signal?: AbortSignal) => {
        if (signal?.aborted) {
          throw new Error('Probe aborted');
        }
        return new Promise<void>((_, rej) => {
          signal?.addEventListener('abort', () => rej(new Error('Probe aborted')));
        });
      }),
      close: vi.fn().mockRejectedValue(new Error('Database close pool error')),
    });

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      abortController: controller,
      shutdownTimeoutMs: 5000,
      terminate: terminateSpy,
      installSignalHandlers: false,
    });

    controller.abort();

    await expect(workerPromise).rejects.toThrow('Database close pool error');
    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledWith(1);
    expect(terminateSpy).not.toHaveBeenCalledWith(0);

    consoleErrorSpy.mockRestore();
  });

  it('forces exit code 1 when remaining deadline budget is zero during probe cleanup', async () => {
    let callCount = 0;
    const now = () => {
      callCount++;
      // First call (during shutdown initialization): 1000ms (deadline = 6000ms)
      // Subsequent calls: 7000ms (budget already exhausted, remaining = 0ms)
      return callCount === 1 ? 1000 : 7000;
    };
    const terminateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const controller = new AbortController();
    const mockDb = createMockDatabase({
      probe: vi.fn(async () => {
        throw new Error('Database connection failed');
      }),
      close: vi.fn(async () => {}),
    });

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      abortController: controller,
      shutdownTimeoutMs: 5000,
      now,
      terminate: terminateSpy,
      installSignalHandlers: false,
    });

    await expect(workerPromise).rejects.toThrow(/Worker startup cleanup timed out/);
    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledWith(1);

    consoleErrorSpy.mockRestore();
  });

  it('preserves termination code 1 and ignores late completion after deadline expiry', async () => {
    let fakeTime = 1000;
    const now = () => fakeTime;
    const terminateSpy = vi.fn();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const timers: { id: number; fn: () => void }[] = [];
    let timerSeq = 0;
    const setTimer = (fn: () => void) => {
      const id = ++timerSeq;
      timers.push({ id, fn });
      return id;
    };
    const clearTimer = (id: unknown) => {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx !== -1) {
        timers.splice(idx, 1);
      }
    };

    let resolveClose!: () => void;
    const closePromise = new Promise<void>((r) => {
      resolveClose = r;
    });

    const mockDb = createMockDatabase({
      close: vi.fn((() => {
        fakeTime += 6000;
        queueMicrotask(() => {
          const timer = timers.shift();
          timer?.fn();
        });
        return closePromise;
      }) as never),
    });

    const controller = new AbortController();
    let runnerStartedResolve!: () => void;
    const runnerStartedPromise = new Promise<void>((resolve) => {
      runnerStartedResolve = resolve;
    });

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      abortController: controller,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      terminate: terminateSpy,
      installSignalHandlers: false,
      workerRunner: async () => {
        runnerStartedResolve();
        return Promise.resolve();
      },
    });

    await runnerStartedPromise;
    controller.abort();
    await expect(workerPromise).rejects.toThrow(/timed out/);

    expect(terminateSpy).toHaveBeenCalledWith(1);

    // Late close resolves after deadline expiry
    resolveClose();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(terminateSpy).not.toHaveBeenCalledWith(0);

    const logs = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs).not.toContain('Worker process stopped gracefully');

    consoleLogSpy.mockRestore();
  });

  it('installs and cleans up signal listeners during worker lifecycle', async () => {
    const initialSigint = process.listenerCount('SIGINT');
    const initialSigterm = process.listenerCount('SIGTERM');

    const controller = new AbortController();
    const mockDb = createMockDatabase();

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      abortController: controller,
      installSignalHandlers: true,
    });

    expect(process.listenerCount('SIGINT')).toBe(initialSigint + 1);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigterm + 1);

    controller.abort();
    await workerPromise;

    expect(process.listenerCount('SIGINT')).toBe(initialSigint);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigterm);
    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });

  it('handles SIGINT gracefully by running shutdown path and closing resources', async () => {
    const handleRef = vi.fn();
    const handleClose = vi.fn();
    let resolveStarted: () => void;
    const startedPromise = new Promise<void>((r) => {
      resolveStarted = r;
    });
    const onStarted = vi.fn(() => resolveStarted());
    const mockDb = createMockDatabase();

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      installSignalHandlers: true,
      onStarted,
      runtimeHandle: {
        ref: handleRef,
        close: handleClose,
      },
    });

    await startedPromise;
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(handleRef).toHaveBeenCalledTimes(1);
    expect(handleClose).not.toHaveBeenCalled();

    process.emit('SIGINT');

    await expect(workerPromise).resolves.toBeUndefined();
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });

  it('handles SIGTERM gracefully by running shutdown path and closing resources', async () => {
    const handleRef = vi.fn();
    const handleClose = vi.fn();
    let resolveStarted: () => void;
    const startedPromise = new Promise<void>((r) => {
      resolveStarted = r;
    });
    const onStarted = vi.fn(() => resolveStarted());
    const mockDb = createMockDatabase();

    const workerPromise = startWorker({
      config: mockConfig,
      database: mockDb,
      installSignalHandlers: true,
      onStarted,
      runtimeHandle: {
        ref: handleRef,
        close: handleClose,
      },
    });

    await startedPromise;
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(handleRef).toHaveBeenCalledTimes(1);
    expect(handleClose).not.toHaveBeenCalled();

    process.emit('SIGTERM');

    await expect(workerPromise).resolves.toBeUndefined();
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });

  it('proves graceful handling on SIGINT in a real process exiting with code 0', async () => {
    const { spawn } = await import('node:child_process');
    const path = await import('node:path');

    const workerDir = path.resolve(__dirname, '..');
    const workerScript = path.resolve(workerDir, 'test/fixtures/test-worker-entry.ts');
    const child = spawn(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', workerScript],
      {
        cwd: workerDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LOG_LEVEL: 'info',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

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
        15000,
      );
      const interval = setInterval(() => {
        if (output.includes('Worker process started and entering idle state')) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(child.exitCode).toBeNull();
    expect(child.killed).toBe(false);

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );

    child.stdin.write('SIGINT\n');
    const exit = await exitPromise;

    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
    expect(output).toContain('Worker process received SIGINT, shutting down gracefully');
    expect(output).toContain('Worker process stopped gracefully');
  }, 20000);

  it('proves graceful handling on SIGTERM in a real process exiting with code 0', async () => {
    const { spawn } = await import('node:child_process');
    const path = await import('node:path');

    const workerDir = path.resolve(__dirname, '..');
    const workerScript = path.resolve(workerDir, 'test/fixtures/test-worker-entry.ts');
    const child = spawn(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', workerScript],
      {
        cwd: workerDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LOG_LEVEL: 'info',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

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
        15000,
      );
      const interval = setInterval(() => {
        if (output.includes('Worker process started and entering idle state')) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(child.exitCode).toBeNull();
    expect(child.killed).toBe(false);

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );

    child.stdin.write('SIGTERM\n');
    const exit = await exitPromise;

    expect(exit.code).toBe(0);
    expect(exit.signal).toBeNull();
    expect(output).toContain('Worker process received SIGTERM, shutting down gracefully');
    expect(output).toContain('Worker process stopped gracefully');
  }, 20000);
});
