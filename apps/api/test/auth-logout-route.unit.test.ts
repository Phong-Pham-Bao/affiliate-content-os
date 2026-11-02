import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import { createMockAuthDeps, createTestAuthConfig } from './helpers/auth-test-fakes.js';

describe('POST /api/v1/logout route', { timeout: 15000 }, () => {
  const validSessionCookie = 'A'.repeat(43);

  it('returns 503 AUTH_NOT_CONFIGURED when auth is disabled', async () => {
    const auth = createMockAuthDeps({ config: createTestAuthConfig({ enabled: false }) });
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('rejects Origin: null with 403 AUTH_ORIGIN_INVALID', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
      headers: {
        origin: 'null',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('AUTH_ORIGIN_INVALID');
  });

  it('rejects mismatched Origin with 403 AUTH_ORIGIN_INVALID', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
      headers: {
        origin: 'https://attacker.example.com',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('AUTH_ORIGIN_INVALID');
  });

  it('rejects Origin containing path or malformed URL with 403 AUTH_ORIGIN_INVALID', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const hostileOrigins = [
      'http://127.0.0.1:3000/path',
      'not-a-url',
      'http://127.0.0.1:3000?query=1',
      'javascript:void(0)',
    ];

    for (const origin of hostileOrigins) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/logout',
        headers: { origin },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('AUTH_ORIGIN_INVALID');
    }
  });

  it('rejects unexpected query parameters or body with 400 AUTH_REQUEST_INVALID', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const queryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/logout?extra=1',
      headers: { origin: 'http://127.0.0.1:3000' },
    });
    expect(queryResponse.statusCode).toBe(400);

    const bodyResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
      headers: { origin: 'http://127.0.0.1:3000' },
      payload: { unexpected: 'body' },
    });
    expect(bodyResponse.statusCode).toBe(400);
  });

  it('revokes session, clears session cookie, and returns 204 with empty body on valid logout', async () => {
    const auth = createMockAuthDeps();
    let revoked = false;
    auth.sessionStore.revokeMatchingSessionsByTokenHash = async () => {
      revoked = true;
    };

    const app = createApp({ auth });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
      headers: {
        origin: 'http://127.0.0.1:3000',
      },
      cookies: {
        [COOKIE_SESSION]: validSessionCookie,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(revoked).toBe(true);

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${COOKIE_SESSION}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('is idempotent and returns 204 even when session cookie is absent or already invalid', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
      headers: {
        origin: 'http://127.0.0.1:3000',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${COOKIE_SESSION}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('enforces rate limit of 30 requests per 60 seconds per IP', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    for (let i = 0; i < 30; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/logout',
        headers: { origin: 'http://127.0.0.1:3000' },
      });
      expect(res.statusCode).toBe(204);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
      headers: { origin: 'http://127.0.0.1:3000' },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
