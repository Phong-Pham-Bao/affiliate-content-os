import { describe, expect, it, vi } from 'vitest';
import { loadConfig, ConfigurationError, type AppConfig } from '@affiliate-content-os/config';
import { createApp } from '../src/app.js';
import { startApiServer } from '../src/server.js';

const testConfig: AppConfig = Object.freeze({
  nodeEnv: 'test',
  logLevel: 'info',
  apiHost: '127.0.0.1',
  apiPort: 3001,
});

describe('apps/api - createApp factory', () => {
  it('creates independent Fastify instances on successive calls', () => {
    const app1 = createApp({ config: testConfig });
    const app2 = createApp({ config: testConfig });

    expect(app1).not.toBe(app2);
  });

  it('answers GET /health/live with 200, JSON, and exact operational payload', async () => {
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

  it('starts and closes cleanly using an injected listener without public test ports', async () => {
    const server = await startApiServer({
      config: testConfig,
      installSignalHandlers: false,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    expect(server.config.apiHost).toBe('127.0.0.1');
    expect(server.config.apiPort).toBe(3001);

    // Bounded and idempotent close
    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('handles shutdown while starting', async () => {
    let proceedStartup: () => void = () => {};
    const startupBarrier = new Promise<void>((resolve) => {
      proceedStartup = resolve;
    });

    const serverPromise = startApiServer({
      config: testConfig,
      installSignalHandlers: false,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
        await startupBarrier;
      },
    });

    setTimeout(() => {
      proceedStartup();
    }, 20);

    const server = await serverPromise;
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('handles shutdown while already closing idempotently', async () => {
    const server = await startApiServer({
      config: testConfig,
      installSignalHandlers: false,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    const close1 = server.close();
    const close2 = server.close();

    expect(close1).toBe(close2);
    await expect(Promise.all([close1, close2])).resolves.toEqual([undefined, undefined]);
  });

  it('handles repeated signals safely without duplicate shutdown or leakage', async () => {
    const initialSigintCount = process.listenerCount('SIGINT');
    const initialSigtermCount = process.listenerCount('SIGTERM');
    const terminateSpy = vi.fn();

    const server = await startApiServer({
      config: testConfig,
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
  });

  it('logs failure and invokes terminate(1) when close() rejects', async () => {
    const customApp = createApp({ config: testConfig });
    const shutdownError = new Error('Simulated close failure');
    vi.spyOn(customApp, 'close').mockRejectedValueOnce(shutdownError);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const terminateSpy = vi.fn();

    const server = await startApiServer({
      config: testConfig,
      app: customApp,
      installSignalHandlers: false,
      terminate: terminateSpy,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    await expect(server.close()).rejects.toThrow('Simulated close failure');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('API server shutdown failure: Simulated close failure'),
    );
    expect(terminateSpy).toHaveBeenCalledWith(1);
    consoleErrorSpy.mockRestore();
  });

  it('logs failure and invokes terminate(1) when shutdown exceeds deadline', async () => {
    const customApp = createApp({ config: testConfig });
    vi.spyOn(customApp, 'close').mockImplementation((() => new Promise<void>(() => {})) as never);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const terminateSpy = vi.fn();

    const server = await startApiServer({
      config: testConfig,
      app: customApp,
      installSignalHandlers: false,
      shutdownTimeoutMs: 30,
      terminate: terminateSpy,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    await expect(server.close()).rejects.toThrow(/timed out/);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'API server shutdown failure: API server graceful shutdown timed out after 30ms',
      ),
    );
    expect(terminateSpy).toHaveBeenCalledWith(1);
    consoleErrorSpy.mockRestore();
  });

  it('forces nonzero termination when signal shutdown exceeds deadline', async () => {
    const customApp = createApp({ config: testConfig });
    vi.spyOn(customApp, 'close').mockImplementation((() => new Promise<void>(() => {})) as never);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const terminateSpy = vi.fn();

    await startApiServer({
      config: testConfig,
      app: customApp,
      installSignalHandlers: true,
      shutdownTimeoutMs: 30,
      terminate: terminateSpy,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    process.emit('SIGTERM');

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'API server shutdown failure: API server graceful shutdown timed out after 30ms',
      ),
    );
    expect(terminateSpy).toHaveBeenCalledWith(1);
    consoleErrorSpy.mockRestore();
  });

  it('bounds shutdown when SIGINT arrives during permanently pending startup', async () => {
    const initialSigintCount = process.listenerCount('SIGINT');
    const initialSigtermCount = process.listenerCount('SIGTERM');

    const terminateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Permanently pending listener
    const pendingListener = () => new Promise<void>(() => {});

    let startupSettled = false;
    let startupError: unknown = null;

    const startPromise = startApiServer({
      config: testConfig,
      listener: pendingListener,
      shutdownTimeoutMs: 40,
      terminate: terminateSpy,
      installSignalHandlers: true,
    }).then(
      () => {
        startupSettled = true;
      },
      (err) => {
        startupSettled = true;
        startupError = err;
      },
    );

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount + 1);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount + 1);

    // Trigger signal while startup is pending
    process.emit('SIGINT');

    // Emit repeated signals to verify idempotence
    process.emit('SIGTERM');
    process.emit('SIGINT');

    // Wait for startPromise to settle
    await startPromise;

    expect(startupSettled).toBe(true);
    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).message).toMatch(/timed out after 40ms/);

    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledWith(1);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'API server shutdown failure: API server graceful shutdown timed out after 40ms',
      ),
    );

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount);

    consoleErrorSpy.mockRestore();
  });

  it('bounds shutdown when SIGTERM arrives during permanently pending startup', async () => {
    const initialSigintCount = process.listenerCount('SIGINT');
    const initialSigtermCount = process.listenerCount('SIGTERM');

    const terminateSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pendingListener = () => new Promise<void>(() => {});

    let startupSettled = false;
    let startupError: unknown = null;

    const startPromise = startApiServer({
      config: testConfig,
      listener: pendingListener,
      shutdownTimeoutMs: 40,
      terminate: terminateSpy,
      installSignalHandlers: true,
    }).then(
      () => {
        startupSettled = true;
      },
      (err) => {
        startupSettled = true;
        startupError = err;
      },
    );

    process.emit('SIGTERM');
    process.emit('SIGTERM');

    await startPromise;

    expect(startupSettled).toBe(true);
    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).message).toMatch(/timed out after 40ms/);

    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledWith(1);

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount);

    consoleErrorSpy.mockRestore();
  });

  it('handles signal shutdown gracefully when startup completes within deadline', async () => {
    const initialSigintCount = process.listenerCount('SIGINT');
    const initialSigtermCount = process.listenerCount('SIGTERM');

    const terminateSpy = vi.fn();
    let proceedStartup: () => void = () => {};
    const startupBarrier = new Promise<void>((resolve) => {
      proceedStartup = resolve;
    });

    const startPromise = startApiServer({
      config: testConfig,
      installSignalHandlers: true,
      shutdownTimeoutMs: 100,
      terminate: terminateSpy,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
        await startupBarrier;
      },
    });

    // Signal received during startup
    process.emit('SIGINT');

    // Startup finishes within deadline
    setTimeout(() => {
      proceedStartup();
    }, 20);

    const server = await startPromise;
    expect(server).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(terminateSpy).toHaveBeenCalledWith(0);
    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount);
  });
});
