import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION, COOKIE_TRANSACTION } from '../src/auth/constants.js';
import { createMockAuthDeps, createTestAuthConfig } from './helpers/auth-test-fakes.js';

describe('GET /auth/callback route', { timeout: 30000 }, () => {
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

  it('successfully completes login and sets session cookie for an actual Google-shaped callback containing scope, authuser, prompt, hd, and iss', async () => {
    const auth = createMockAuthDeps();
    let exchangedCode: string | undefined;
    let exchangedIss: string | undefined;
    auth.oidcProtocolPort.exchangeCodeAndValidateIdToken = async ({ code, iss }) => {
      exchangedCode = code;
      exchangedIss = iss;
      return {
        status: 'verified',
        claims: {
          issuer: 'https://accounts.google.com',
          subject: 'sub-123',
          email: 'user@example.com',
          displayName: 'Test User',
        },
      };
    };

    auth.identityResolution.identityDirectory.findUsersByIdentity = async () => [
      Object.freeze({
        id: '0192b012-3456-789a-8bcd-ef0123456789' as never,
        identityProvider: 'https://accounts.google.com',
        identitySubject: 'sub-123',
        email: 'user@example.com',
        displayName: 'Test User',
        status: 'active',
        createdAt: '2026-11-02T12:00:00.000Z' as never,
        updatedAt: '2026-11-02T12:00:00.000Z' as never,
        version: 1,
      }),
    ];

    let consumedStateHash: Uint8Array | undefined;
    let consumedCookieHash: Uint8Array | undefined;
    auth.loginTransactionStore.consumePendingTransaction = async ({
      stateHash,
      browserBindingHash,
    }) => {
      consumedStateHash = stateHash;
      consumedCookieHash = browserBindingHash;
      return {
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
      };
    };

    const app = createApp({ auth });
    const rawState = 'state-raw-value-32-chars-long-123456789012';
    const rawCookie = 'binding-raw-value-32-chars-long-12345678901';

    const response = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=4%2F0AY0e-g7_actual_google_code&state=${rawState}&scope=email%20profile%20openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile&authuser=0&prompt=consent&hd=example.com&iss=https%3A%2F%2Faccounts.google.com`,
      cookies: {
        [COOKIE_TRANSACTION]: rawCookie,
      },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('http://127.0.0.1:3000/dashboard/overview');
    expect(exchangedCode).toBe('4/0AY0e-g7_actual_google_code');
    expect(exchangedIss).toBe('https://accounts.google.com');
    expect(consumedStateHash).toBeDefined();
    expect(consumedCookieHash).toBeDefined();

    const rawSetCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
    const sessionCookie = cookies.find((c) => c?.startsWith(`${COOKIE_SESSION}=`));
    const txClearCookie = cookies.find((c) => c?.startsWith(`${COOKIE_TRANSACTION}=;`));

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(txClearCookie).toBeDefined();
    expect(txClearCookie).toContain('Max-Age=0');
  });

  it('safely ignores bounded unrecognized OAuth response parameters per RFC 6749 and allows login', async () => {
    const auth = createMockAuthDeps();
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
      url: '/auth/callback?code=valid-code&state=state-raw-value-32-chars-long-123456789012&session_state=xyz789&unknown_provider_param=custom_value',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('http://127.0.0.1:3000/dashboard/overview');
  });

  it('rejects duplicate query parameters even if unrecognized with 400 and causes zero persistence calls', async () => {
    const auth = createMockAuthDeps();
    let consumeCalled = false;
    auth.loginTransactionStore.consumePendingTransaction = async () => {
      consumeCalled = true;
      return null;
    };

    const app = createApp({ auth });

    // Test duplicate code
    const response0 = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=valid-code1&code=valid-code2&state=valid-state',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response0.statusCode).toBe(400);
    expect(response0.json().code).toBe('OIDC_CALLBACK_INVALID');

    // Test duplicate unrecognized parameter 'scope'
    const response1 = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=valid-code&state=valid-state&scope=email&scope=profile',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response1.statusCode).toBe(400);
    expect(response1.json().code).toBe('OIDC_CALLBACK_INVALID');

    // Test duplicate unrecognized parameter via percent encoding '%73cope' vs 'scope'
    const response2 = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=valid-code&state=valid-state&%73cope=email&scope=profile',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response2.statusCode).toBe(400);
    expect(response2.json().code).toBe('OIDC_CALLBACK_INVALID');

    // Test duplicate iss parameter
    const response3 = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=valid-code&state=valid-state&iss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response3.statusCode).toBe(400);
    expect(response3.json().code).toBe('OIDC_CALLBACK_INVALID');

    // Test duplicate iss parameter via raw percent encoding '%69ss' vs 'iss'
    const response4 = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=valid-code&state=valid-state&%69ss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com',
      cookies: {
        [COOKIE_TRANSACTION]: 'binding-raw-value-32-chars-long-12345678901',
      },
    });

    expect(response4.statusCode).toBe(400);
    expect(response4.json().code).toBe('OIDC_CALLBACK_INVALID');
    expect(consumeCalled).toBe(false);
  });

  it('rejects hostile values in query parameters with 400 and causes zero persistence calls', async () => {
    const auth = createMockAuthDeps();
    let consumeCalled = false;
    auth.loginTransactionStore.consumePendingTransaction = async () => {
      consumeCalled = true;
      return null;
    };

    const app = createApp({ auth });

    const hostileUrls = [
      // Control character in unrecognized param value
      '/auth/callback?code=valid-code&state=valid-state&scope=email%0Aprofile',
      '/auth/callback?code=valid-code&state=valid-state&prompt=consent%00',
      // Control character in unrecognized param key
      '/auth/callback?code=valid-code&state=valid-state&scope%0A=val',
      // Hostile prototype pollution keys
      '/auth/callback?code=valid-code&state=valid-state&__proto__=polluted',
      '/auth/callback?code=valid-code&state=valid-state&constructor=bad',
      '/auth/callback?code=valid-code&state=valid-state&prototype=bad',
      // Oversized unrecognized key (> 256)
      `/auth/callback?code=valid-code&state=valid-state&${'k'.repeat(257)}=val`,
      // Oversized unrecognized value (> 4096)
      `/auth/callback?code=valid-code&state=valid-state&scope=${'v'.repeat(4097)}`,
      // Empty key
      '/auth/callback?code=valid-code&state=valid-state&=val',
      // Hostile iss values: control character, oversized, empty
      '/auth/callback?code=valid-code&state=valid-state&iss=https%3A%2F%2Faccounts.google.com%0A',
      `/auth/callback?code=valid-code&state=valid-state&iss=https%3A%2F%2Fexample.com%2F${'x'.repeat(2048)}`,
      '/auth/callback?code=valid-code&state=valid-state&iss=',
      // Conflicting code and error with extra params
      '/auth/callback?code=valid-code&error=access_denied&state=valid-state&scope=email',
      // Code with error_description and extra params
      '/auth/callback?code=valid-code&state=valid-state&error_description=denied&scope=email',
      // Code with error_uri and extra params
      '/auth/callback?code=valid-code&state=valid-state&error_uri=https%3A%2F%2Fexample.com&scope=email',
      // Missing state
      '/auth/callback?code=valid-code&scope=email&authuser=0',
      // Semicolon separator
      '/auth/callback?code=valid-code&state=valid-state;scope=email',
      // Consecutive ampersands
      '/auth/callback?code=valid-code&&state=valid-state',
      // Leading ampersand
      '/auth/callback?&code=valid-code&state=valid-state',
      // Trailing ampersand
      '/auth/callback?code=valid-code&state=valid-state&',
    ];

    for (const url of hostileUrls) {
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
      '/auth/callback?code=valid&state=s&scope=%2g',
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
