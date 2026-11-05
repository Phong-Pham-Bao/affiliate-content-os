import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION, COOKIE_TRANSACTION } from '../src/auth/constants.js';
import { createMockAuthDeps, createTestAuthConfig } from './helpers/auth-test-fakes.js';

describe('GET /auth/callback route', { timeout: 15000 }, () => {
  it('returns 503 AUTH_NOT_CONFIGURED when auth is disabled', async () => {
    const auth = createMockAuthDeps({ config: createTestAuthConfig({ enabled: false }) });
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=xyz',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('returns 400 OIDC_CALLBACK_INVALID and clears transaction cookie when query is missing', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('OIDC_CALLBACK_INVALID');

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${COOKIE_TRANSACTION}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('returns 400 OIDC_CALLBACK_INVALID when transaction cookie is missing', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=abc&state=xyz',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('OIDC_CALLBACK_INVALID');
  });

  it('returns 303 redirect with session cookie and clears transaction cookie on success', async () => {
    const auth = createMockAuthDeps();
    // Configure consumePendingTransaction to return a valid transaction
    auth.loginTransactionStore.consumePendingTransaction = async () => ({
      id: '0192b012-3456-789a-8bcd-ef0123456789',
      keyVersion: 'v1',
      returnTo: '/dashboard/overview',
      encryptedSecrets: {
        ciphertext: new Uint8Array([1, 2, 3]),
        iv: new Uint8Array(12).fill(4),
        authTag: new Uint8Array(16).fill(5),
        keyVersion: 'v1',
      },
      createdAt: '2026-11-02T12:00:00.000Z',
      expiresAt: '2026-11-02T12:10:00.000Z',
    });

    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=valid-code&state=state-raw-value-32-chars-long-123456789012',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('http://127.0.0.1:3000/dashboard/overview');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['pragma']).toBe('no-cache');
    expect(response.headers['referrer-policy']).toBe('no-referrer');

    // Headers set-cookie should contain both: clear transaction cookie and set session cookie
    const rawSetCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
    const sessionCookie = cookies.find((c) => c?.startsWith(`${COOKIE_SESSION}=`));
    const txClearCookie = cookies.find((c) => c?.startsWith(`${COOKIE_TRANSACTION}=;`));

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');

    expect(txClearCookie).toBeDefined();
    expect(txClearCookie).toContain('Max-Age=0');
  });

  it('rejects unexpected query parameters with 400 and causes zero persistence calls', async () => {
    const auth = createMockAuthDeps();
    let consumeCalled = false;
    auth.loginTransactionStore.consumePendingTransaction = async () => {
      consumeCalled = true;
      return null;
    };

    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=valid-code&state=valid-state&unexpected=intruder',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('OIDC_CALLBACK_INVALID');
    expect(consumeCalled).toBe(false);
  });

  it('rejects duplicate query parameters with 400 and causes zero persistence calls', async () => {
    const auth = createMockAuthDeps();
    let consumeCalled = false;
    auth.loginTransactionStore.consumePendingTransaction = async () => {
      consumeCalled = true;
      return null;
    };

    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=valid-code1&code=valid-code2&state=valid-state',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('OIDC_CALLBACK_INVALID');
    expect(consumeCalled).toBe(false);
  });

  it('rejects malformed percent encoding and causes zero persistence or crypto calls', async () => {
    const auth = createMockAuthDeps();
    let consumeCalls = 0;
    auth.loginTransactionStore.consumePendingTransaction = async () => {
      consumeCalls++;
      return null;
    };

    const app = createApp({ auth });

    const malformedUrls = [
      '/auth/callback?code=%&state=s',
      '/auth/callback?code=%2&state=s',
      '/auth/callback?code=%2g&state=s',
      '/auth/callback?code=valid&%63ode=valid2&state=s',
      '/auth/callback?code=valid&state=s?secondary',
      '/auth/callback?code=valid&state=%C3',
      '/auth/callback?code=valid&state=s&unknown=1',
    ];

    for (const url of malformedUrls) {
      const response = await app.inject({
        method: 'GET',
        url,
        cookies: {
          [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('OIDC_CALLBACK_INVALID');
    }
    expect(consumeCalls).toBe(0);
  });

  it('enforces rate limit of 20 requests per 60 seconds per IP', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/callback',
      });
      expect(res.statusCode).toBe(400);
    }

    const blocked = await app.inject({
      method: 'GET',
      url: '/auth/callback',
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
