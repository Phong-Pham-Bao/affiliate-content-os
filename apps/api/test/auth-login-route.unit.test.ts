import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_TRANSACTION } from '../src/auth/constants.js';
import { createMockAuthDeps, createTestAuthConfig } from './helpers/auth-test-fakes.js';

describe('GET /auth/login route', { timeout: 15000 }, () => {
  it('returns 503 AUTH_NOT_CONFIGURED problem details when auth is disabled', async () => {
    const auth = createMockAuthDeps({ config: createTestAuthConfig({ enabled: false }) });
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/login',
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = response.json();
    expect(body.code).toBe('AUTH_NOT_CONFIGURED');
    expect(body.status).toBe(503);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('returns 400 AUTH_REQUEST_INVALID when unexpected query parameters are provided', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/login?unexpected=foo',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = response.json();
    expect(body.code).toBe('AUTH_REQUEST_INVALID');
  });

  it('returns 400 AUTH_REQUEST_INVALID when returnTo is an open redirect or invalid path', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const hostileUrls = [
      '//evil.com',
      'https://evil.com',
      '/path\\with\\backslash',
      '/path/with\0null',
      'javascript:alert(1)',
      '/' + 'a'.repeat(2049),
    ];

    for (const url of hostileUrls) {
      const response = await app.inject({
        method: 'GET',
        url: `/auth/login?returnTo=${encodeURIComponent(url)}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('AUTH_REQUEST_INVALID');
    }
  });

  it('returns 302 redirect with transaction cookie and security headers on valid request', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/login?returnTo=/dashboard',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://auth.example.com/oauth/authorize?state=123');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['pragma']).toBe('no-cache');
    expect(response.headers['referrer-policy']).toBe('no-referrer');

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${COOKIE_TRANSACTION}=`);
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=600');
  });

  it('enforces rate limit of 10 requests per 60 seconds per IP', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/login',
      });
      expect(res.statusCode).toBe(302);
    }

    const blocked = await app.inject({
      method: 'GET',
      url: '/auth/login',
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = blocked.json();
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.status).toBe(429);
    expect(body.retryAfterSeconds).toBeDefined();
    expect(typeof body.retryAfterSeconds).toBe('number');
  });
});
