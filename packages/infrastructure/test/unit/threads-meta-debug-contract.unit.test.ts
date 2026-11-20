import { describe, expect, it, vi } from 'vitest';
import { SocialAuthOutcomeUnknownError } from '@affiliate-content-os/application';
import { ThreadsSocialAuthAdapter, type HttpTransport } from '../../src/social/index.js';

describe('Meta debug_token contract tests for ThreadsSocialAuthAdapter', () => {
  const baseOptions = {
    appId: 'threads-app-123',
    appSecret: 'super-secret-threads-key-456',
    authBaseUrl: 'https://www.threads.com',
    apiBaseUrl: 'https://graph.threads.com',
    apiVersion: 'v1.0',
    metaGraphBaseUrl: 'https://graph.facebook.com',
    metaGraphVersion: 'v21.0',
    appAccessToken: 'injected_app_token_xyz',
    timeoutMs: 5000,
    environment: 'local' as const,
  };

  it('uses exact origin, version, path, query params, and Authorization header for debug_token', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        if (req.url.includes('/me?')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'user_101', username: 'test_user', name: 'Test' }),
          };
        }
        if (req.url.includes('/debug_token')) {
          capturedUrl = req.url;
          capturedHeaders = (req.headers ?? {}) as Record<string, string>;
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              data: {
                app_id: 'threads-app-123',
                user_id: 'user_101',
                is_valid: true,
                scopes: ['threads_basic', 'threads_content_publish'],
                expires_at: 1735689600,
              },
            }),
          };
        }
        return { status: 404, headers: {}, body: '{}' };
      }),
    };

    const adapter = new ThreadsSocialAuthAdapter({ ...baseOptions, transport: mockTransport });
    const result = await adapter.inspectCurrentAccount({ accessToken: 'user_live_token_777' });

    expect(result.providerAccountId).toBe('user_101');
    expect(capturedUrl).toContain('https://graph.facebook.com/v21.0/debug_token');
    const parsed = new URL(capturedUrl);
    expect(parsed.origin).toBe('https://graph.facebook.com');
    expect(parsed.pathname).toBe('/v21.0/debug_token');
    expect(parsed.searchParams.get('input_token')).toBe('user_live_token_777');
    expect(parsed.searchParams.get('access_token')).toBe('injected_app_token_xyz');
    expect(capturedHeaders['Authorization']).toBe('Bearer injected_app_token_xyz');
    expect(capturedHeaders['Accept']).toBe('application/json');
  });

  it('fetches app access token dynamically via client_credentials when not injected and caches it', async () => {
    const urlsCalled: string[] = [];
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        urlsCalled.push(req.url);
        if (req.url.includes('/oauth/access_token')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              access_token: 'dynamically_fetched_app_token',
              token_type: 'bearer',
            }),
          };
        }
        if (req.url.includes('/me?')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'user_102', username: 'dyn_user' }),
          };
        }
        if (req.url.includes('/debug_token')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              data: {
                app_id: 'threads-app-123',
                user_id: 'user_102',
                is_valid: true,
                scopes: ['threads_basic', 'threads_content_publish'],
              },
            }),
          };
        }
        return { status: 404, headers: {}, body: '{}' };
      }),
    };

    const { appAccessToken: _, ...optsWithoutAppToken } = baseOptions;
    const adapter = new ThreadsSocialAuthAdapter({
      ...optsWithoutAppToken,
      transport: mockTransport,
    });

    await adapter.inspectCurrentAccount({ accessToken: 'tok1' });
    await adapter.inspectCurrentAccount({ accessToken: 'tok2' });

    const clientCredCalls = urlsCalled.filter((u) => u.includes('/oauth/access_token'));
    expect(clientCredCalls.length).toBe(1);
    expect(clientCredCalls[0]).toContain('grant_type=client_credentials');
    expect(clientCredCalls[0]).toContain('client_id=threads-app-123');
    expect(clientCredCalls[0]).toContain('client_secret=super-secret-threads-key-456');
  });

  it('throws SocialAuthExchangeError when debug_token app_id does not match configured app_id', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        if (req.url.includes('/me?')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'u1' }),
          };
        }
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              app_id: 'rogue-app-999',
              user_id: 'u1',
              is_valid: true,
              scopes: ['threads_basic'],
            },
          }),
        };
      }),
    };
    const adapter = new ThreadsSocialAuthAdapter({ ...baseOptions, transport: mockTransport });
    await expect(adapter.inspectCurrentAccount({ accessToken: 'tok' })).rejects.toThrow(
      'Meta debug_token app_id does not match configured app_id',
    );
  });

  it('throws SocialAuthExchangeError when debug_token user_id does not match provider account ID', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        if (req.url.includes('/me?')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'u1' }),
          };
        }
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              app_id: 'threads-app-123',
              user_id: 'imposter-user-456',
              is_valid: true,
              scopes: ['threads_basic'],
            },
          }),
        };
      }),
    };
    const adapter = new ThreadsSocialAuthAdapter({ ...baseOptions, transport: mockTransport });
    await expect(adapter.inspectCurrentAccount({ accessToken: 'tok' })).rejects.toThrow(
      'Meta debug_token user_id does not match provider account ID',
    );
  });

  it('rejects with SocialAuthExchangeError when is_valid is false', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        if (req.url.includes('/me?')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'u1' }),
          };
        }
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: { app_id: 'threads-app-123', user_id: 'u1', is_valid: false, scopes: [] },
          }),
        };
      }),
    };
    const adapter = new ThreadsSocialAuthAdapter({ ...baseOptions, transport: mockTransport });
    await expect(adapter.inspectCurrentAccount({ accessToken: 'tok' })).rejects.toThrow(
      'Token is not valid according to Meta debug_token endpoint',
    );
  });

  it('validates expiry bounds and malformed payload wrappers', async () => {
    const mockTransportNegativeExp: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        if (req.url.includes('/me?'))
          return { status: 200, headers: {}, body: JSON.stringify({ id: 'u1' }) };
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              app_id: 'threads-app-123',
              user_id: 'u1',
              is_valid: true,
              scopes: ['threads_basic'],
              expires_at: -50,
            },
          }),
        };
      }),
    };
    const adapterExp = new ThreadsSocialAuthAdapter({
      ...baseOptions,
      transport: mockTransportNegativeExp,
    });
    await expect(adapterExp.inspectCurrentAccount({ accessToken: 'tok' })).rejects.toThrow(
      'Invalid expiry bounds in Meta debug_token response',
    );

    const mockTransportNoData: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        if (req.url.includes('/me?'))
          return { status: 200, headers: {}, body: JSON.stringify({ id: 'u1' }) };
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'none' }),
        };
      }),
    };
    const adapterNoData = new ThreadsSocialAuthAdapter({
      ...baseOptions,
      transport: mockTransportNoData,
    });
    await expect(adapterNoData.inspectCurrentAccount({ accessToken: 'tok' })).rejects.toThrow(
      'Malformed response wrapper from Meta debug_token endpoint',
    );
  });

  it('throws SocialAuthOutcomeUnknownError on debug_token network timeout', async () => {
    const mockTransportTimeout: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        if (req.url.includes('/me?'))
          return { status: 200, headers: {}, body: JSON.stringify({ id: 'u1' }) };
        throw new Error('HTTP request to provider timed out after 5000ms');
      }),
    };
    const adapter = new ThreadsSocialAuthAdapter({
      ...baseOptions,
      transport: mockTransportTimeout,
    });
    await expect(adapter.inspectCurrentAccount({ accessToken: 'tok' })).rejects.toThrow(
      SocialAuthOutcomeUnknownError,
    );
  });

  it('proves that graph.threads.com/v1.0/me/permissions is NEVER called across any flow', async () => {
    const calledUrls: string[] = [];
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockImplementation(async (req) => {
        calledUrls.push(req.url);
        if (req.url.includes('/oauth/access_token')) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({ access_token: 'short_tok', user_id: 'u1' }),
          };
        }
        if (req.url.includes('/access_token?grant_type=th_exchange_token')) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({ access_token: 'long_tok', expires_in: 5184000 }),
          };
        }
        if (req.url.includes('/me?')) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({ id: 'u1', username: 'tester' }),
          };
        }
        if (req.url.includes('/debug_token')) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              data: {
                app_id: 'threads-app-123',
                user_id: 'u1',
                is_valid: true,
                scopes: ['threads_basic', 'threads_content_publish'],
              },
            }),
          };
        }
        return { status: 404, headers: {}, body: '{}' };
      }),
    };

    const adapter = new ThreadsSocialAuthAdapter({ ...baseOptions, transport: mockTransport });
    await adapter.exchangeCode({
      platform: 'threads',
      code: 'code123',
      redirectUri: 'http://localhost/callback',
    });
    await adapter.inspectCurrentAccount({ accessToken: 'long_tok' });

    for (const url of calledUrls) {
      expect(url).not.toContain('permissions');
      expect(url).not.toContain('/me/permissions');
    }
  });
});
