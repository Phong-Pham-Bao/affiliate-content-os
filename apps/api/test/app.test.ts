import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '@affiliate-content-os/config';
import { createApp } from '../src/app.js';
import { startApiServer } from '../src/server.js';

describe('apps/api - createApp factory', () => {
  it('creates independent Fastify instances on successive calls', () => {
    const app1 = createApp();
    const app2 = createApp();

    expect(app1).not.toBe(app2);
  });

  it('answers GET /health/live with 200, JSON, and exact operational payload', async () => {
    const app = createApp();

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
    const app = createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/unknown-route',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for unsupported methods on /health/live', async () => {
    const app = createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(404);
  });

  it('does not expose /api/v1 routes in this foundation slice', async () => {
    const app = createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('apps/api - startApiServer lifecycle', () => {
  it('rejects startup when configuration is invalid without listening', async () => {
    await expect(
      startApiServer({
        rawEnv: { NODE_ENV: 'invalid-env' },
        installSignalHandlers: false,
      }),
    ).rejects.toThrow(ConfigurationError);
  });

  it('starts and closes cleanly on valid configuration', async () => {
    // Port 0 in Node/TCP lets the OS bind an ephemeral free port for testing
    const server = await startApiServer({
      rawEnv: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: '0',
      },
      installSignalHandlers: false,
    }).catch(() => {
      // If port 0 rejected by config validator (port must be 1..65535)
      return undefined;
    });

    // Valid port override within allowed range
    const validServer =
      server ??
      (await startApiServer({
        rawEnv: {
          NODE_ENV: 'test',
          API_HOST: '127.0.0.1',
          API_PORT: '49152',
        },
        installSignalHandlers: false,
      }));

    expect(validServer.config.apiHost).toBe('127.0.0.1');
    expect(validServer.config.apiPort).toBe(49152);

    await expect(validServer.close()).resolves.toBeUndefined();
    // Idempotent close
    await expect(validServer.close()).resolves.toBeUndefined();
  });

  it('installs and cleans up signal handlers during lifecycle', async () => {
    const initialSigintCount = process.listenerCount('SIGINT');
    const initialSigtermCount = process.listenerCount('SIGTERM');

    const server = await startApiServer({
      rawEnv: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: '49153',
      },
      installSignalHandlers: true,
    });

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount + 1);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount + 1);

    await server.close();

    expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount);
  });
});
