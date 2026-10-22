import { describe, expect, it, vi } from 'vitest';
import { loadConfig, ConfigurationError, type AppConfig } from '@affiliate-content-os/config';
import type { Database } from '@affiliate-content-os/infrastructure/database';
import { createApp } from '../src/app.js';
import { startApiServer } from '../src/server.js';

const testConfig: AppConfig = Object.freeze({
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

describe('apps/api - createApp factory', () => {
  it('creates independent Fastify instances on successive calls', () => {
    const app1 = createApp({ config: testConfig });
    const app2 = createApp({ config: testConfig });

    expect(app1).not.toBe(app2);
  });

  it('answers GET /health/live with 200, JSON, and exact operational payload without database queries', async () => {
    const app = createApp({ config: testConfig });

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'api',
    });
  });

  it('returns 404 for unknown routes', async () => {
    const app = createApp({ config: testConfig });

    const response = await app.inject({
      method: 'GET',
      url: '/unknown-route',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for unsupported methods on /health/live', async () => {
    const app = createApp({ config: testConfig });

    const response = await app.inject({
      method: 'POST',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(404);
  });

  it('does not expose /api/v1 routes in this foundation slice', async () => {
    const app = createApp({ config: testConfig });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('apps/api - startApiServer lifecycle', () => {
  it('rejects startup when configuration is invalid without listening', () => {
    expect(() => {
      loadConfig({ NODE_ENV: 'invalid-env' });
    }).toThrow(ConfigurationError);
  });

  it('starts and closes cleanly using an injected database and listener', async () => {
    const mockDb = createMockDatabase();
    const server = await startApiServer({
      config: testConfig,
      database: mockDb,
      installSignalHandlers: false,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    expect(mockDb.probe).toHaveBeenCalledTimes(1);
    expect(server.config.apiHost).toBe('127.0.0.1');
    expect(server.config.apiPort).toBe(3001);

    await expect(server.close()).resolves.toBeUndefined();
    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });

  it('fails before listening when database probe fails and cleans up database pool', async () => {
    const probeError = new Error('Database unreachable');
    const mockDb = createMockDatabase({
      probe: vi.fn().mockRejectedValueOnce(probeError),
    });
    const terminateSpy = vi.fn();
    const listenerSpy = vi.fn();

    await expect(
      startApiServer({
        config: testConfig,
        database: mockDb,
        listener: listenerSpy,
        terminate: terminateSpy,
        installSignalHandlers: false,
      }),
    ).rejects.toThrow('Database unreachable');

    expect(listenerSpy).not.toHaveBeenCalled();
    expect(mockDb.close).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledWith(1);
  });

  it('consumes one single shared deadline across listener and pool shutdown with injected timers', async () => {
    let fakeTime = 1000;
    const now = () => fakeTime;
    const terminateSpy = vi.fn();

    interface FakeTimer {
      id: number;
      fn: () => void;
      ms: number;
    }
    const timers: FakeTimer[] = [];
    let timerIdSeq = 0;

    const setTimer = (fn: () => void, ms: number) => {
      const id = ++timerIdSeq;
      timers.push({ id, fn, ms });
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
        // Pool close consumes 1500ms of the remaining budget
        fakeTime += 1500;
      }),
    });

    const customApp = createApp({ config: testConfig });
    vi.spyOn(customApp, 'close').mockImplementation((async () => {
      // Listener close consumes 2500ms
      fakeTime += 2500;
    }) as never);

    const server = await startApiServer({
      config: testConfig,
      app: customApp,
      database: mockDb,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      terminate: terminateSpy,
      installSignalHandlers: false,
      listener: async (app) => {
        await app.ready();
      },
    });

    await server.close();

    // Total time elapsed: 4000ms <= 5000ms budget
    expect(fakeTime).toBe(5000);
    expect(mockDb.close).toHaveBeenCalledTimes(1);
    expect(terminateSpy).not.toHaveBeenCalled(); // clean programmatic close
  });

  it('triggers forced exit code 1 when listener close exceeds the shared deadline', async () => {
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

    const customApp = createApp({ config: testConfig });
    vi.spyOn(customApp, 'close').mockImplementation((() => {
      // Listener close hangs indefinitely; trigger injected timer
      fakeTime += 6000;
      const timer = timers.shift();
      timer?.fn();
      return new Promise<void>(() => {});
    }) as never);

    const mockDb = createMockDatabase();

    const server = await startApiServer({
      config: testConfig,
      app: customApp,
      database: mockDb,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      terminate: terminateSpy,
      installSignalHandlers: false,
      listener: async (app) => {
        await app.ready();
      },
    });

    await expect(server.close()).rejects.toThrow(/timed out/);
    expect(terminateSpy).toHaveBeenCalledWith(1);
  });

  it('triggers forced exit code 1 when database pool close exceeds remaining deadline budget', async () => {
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

    const customApp = createApp({ config: testConfig });
    vi.spyOn(customApp, 'close').mockImplementation((async () => {
      // Listener close took 4000ms out of 5000ms
      fakeTime += 4000;
    }) as never);

    const mockDb = createMockDatabase({
      close: vi.fn((() => {
        // Pool close exceeds the remaining 1000ms budget
        fakeTime += 2000;
        const timer = timers.shift();
        timer?.fn();
        return new Promise<void>(() => {});
      }) as never),
    });

    const server = await startApiServer({
      config: testConfig,
      app: customApp,
      database: mockDb,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      terminate: terminateSpy,
      installSignalHandlers: false,
      listener: async (app) => {
        await app.ready();
      },
    });

    await expect(server.close()).rejects.toThrow(/timed out/);
    expect(terminateSpy).toHaveBeenCalledWith(1);
  });

  it('preserves termination code 1 and ignores late completion after timeout', async () => {
    let fakeTime = 1000;
    const now = () => fakeTime;
    const terminateSpy = vi.fn();

    let triggerTimeout: (() => void) | undefined;
    const setTimer = (fn: () => void) => {
      triggerTimeout = fn;
      return 1;
    };
    const clearTimer = vi.fn();

    let resolveClose: () => void;
    const mockDb = createMockDatabase({
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveClose = resolve;
          }),
      ),
    });

    const customApp = createApp({ config: testConfig });
    vi.spyOn(customApp, 'close').mockImplementation((async () => {}) as never);

    const server = await startApiServer({
      config: testConfig,
      app: customApp,
      database: mockDb,
      shutdownTimeoutMs: 5000,
      now,
      setTimer,
      clearTimer,
      terminate: terminateSpy,
      installSignalHandlers: false,
      listener: async (app) => {
        await app.ready();
      },
    });

    const closePromise = server.close();
    // Simulate deadline timer firing
    fakeTime += 6000;
    triggerTimeout?.();

    await expect(closePromise).rejects.toThrow(/timed out/);
    expect(terminateSpy).toHaveBeenCalledWith(1);

    // Late completion must not reverse exit code or invoke terminate again
    resolveClose!();
    expect(terminateSpy).toHaveBeenCalledTimes(1);
  });

  it('handles repeated signals safely without duplicate shutdown or leakage', async () => {
    const initialSigintCount = process.listenerCount('SIGINT');
    const initialSigtermCount = process.listenerCount('SIGTERM');
    const terminateSpy = vi.fn();
    const mockDb = createMockDatabase();

    const server = await startApiServer({
      config: testConfig,
      database: mockDb,
      installSignalHandlers: true,
      terminate: terminateSpy,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount + 1);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount + 1);

    process.emit('SIGINT');
    process.emit('SIGTERM');
    process.emit('SIGINT');

    await server.close();

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount);
    expect(terminateSpy).toHaveBeenCalledWith(0);
    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });
});
