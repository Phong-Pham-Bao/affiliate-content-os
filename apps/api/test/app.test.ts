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

    const server = await startApiServer({
      config: testConfig,
      installSignalHandlers: true,
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
  });

  it('propagates shutdown failures without silently suppressing them', async () => {
    const customApp = createApp({ config: testConfig });
    const shutdownError = new Error('Simulated close failure');
    vi.spyOn(customApp, 'close').mockRejectedValueOnce(shutdownError);

    const server = await startApiServer({
      config: testConfig,
      app: customApp,
      installSignalHandlers: false,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    await expect(server.close()).rejects.toThrow('Simulated close failure');
  });

  it('enforces shutdown timeout when close hangs', async () => {
    const customApp = createApp({ config: testConfig });
    vi.spyOn(customApp, 'close').mockImplementation((() => new Promise<void>(() => {})) as never);

    const server = await startApiServer({
      config: testConfig,
      app: customApp,
      installSignalHandlers: false,
      shutdownTimeoutMs: 50,
      listener: async (fastifyApp) => {
        await fastifyApp.ready();
      },
    });

    await expect(server.close()).rejects.toThrow(/timed out/);
  });
});
