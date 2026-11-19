import { describe, expect, it, vi } from 'vitest';
import {
  SocialAuthExchangeError,
  SocialAuthOutcomeUnknownError,
  SocialAuthRateLimitError,
} from '@affiliate-content-os/application';
import { ThreadsSocialAuthAdapter, type HttpTransport } from '../../src/social/index.js';

describe('ThreadsSocialAuthAdapter', () => {
  const defaultOptions = {
    appId: 'threads-app-123',
    appSecret: 'super-secret-threads-key-456',
    authBaseUrl: 'https://threads.net',
    apiBaseUrl: 'https://graph.threads.net',
    apiVersion: 'v1.0',
    timeoutMs: 5000,
    environment: 'local' as const,
  };

  it('generates official Threads authorization URL with standard parameters', async () => {
    const adapter = new ThreadsSocialAuthAdapter(defaultOptions);
    const result = await adapter.createAuthorizationUrl({
      workspaceId: '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f',
      platform: 'threads',
      state: 'random_state_abc123',
      redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
      scopes: ['threads_basic', 'threads_content_publish'],
    });

    expect(result.authorizationUrl).toContain('https://threads.net/oauth/authorize?');
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get('client_id')).toBe('threads-app-123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('threads_basic,threads_content_publish');
    expect(url.searchParams.get('state')).toBe('random_state_abc123');
  });

  it('exchanges authorization code through staged pipeline to long-lived token and profile', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi
        .fn()
        // 1. Short token exchange
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({
            access_token: 'short_token_xyz',
            user_id: 'threads_user_999',
          }),
        })
        // 2. Long token exchange
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({
            access_token: 'long_token_abc',
            token_type: 'bearer',
            expires_in: 5184000,
          }),
        })
        // 3. Profile lookup
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: 'threads_user_999',
            username: 'threads_creator_pro',
            name: 'Threads Creator Pro',
          }),
        })
        // 4. Permissions lookup
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              { permission: 'threads_basic', status: 'granted' },
              { permission: 'threads_content_publish', status: 'granted' },
            ],
          }),
        }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    const result = await adapter.exchangeCode({
      platform: 'threads',
      code: 'valid_auth_code_123',
      redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
    });

    expect(result.providerAccountId).toBe('threads_user_999');
    expect(result.displayName).toBe('Threads Creator Pro');
    expect(result.handle).toBe('@threads_creator_pro');
    expect(result.accessToken).toBe('long_token_abc');
    expect(result.grantedScopes).toEqual(['threads_basic', 'threads_content_publish']);
    expect(result.capabilities).toEqual({ canPublishText: true, canPublishMedia: false });
    expect(result.environment).toBe('local');
    expect(result.isRecoverablePartial).toBe(false);
  });

  it('returns recoverable partial result when post-token profile lookup fails', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi
        .fn()
        // 1. Short token exchange succeeds
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({
            access_token: 'short_token_xyz',
            user_id: 'threads_user_999',
          }),
        })
        // 2. Long token exchange succeeds
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          body: JSON.stringify({
            access_token: 'long_token_abc',
            token_type: 'bearer',
            expires_in: 5184000,
          }),
        })
        // 3. Profile lookup fails with 500
        .mockResolvedValueOnce({
          status: 500,
          headers: {},
          body: JSON.stringify({ error: { message: 'Internal profile server error' } }),
        }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    const result = await adapter.exchangeCode({
      platform: 'threads',
      code: 'valid_auth_code_123',
      redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
    });

    expect(result.isRecoverablePartial).toBe(true);
    expect(result.providerAccountId).toBe('threads_user_999');
    expect(result.accessToken).toBe('long_token_abc');
    expect(result.displayName).toBe('Threads User threads_user_999');
  });

  it('throws SocialAuthOutcomeUnknownError on pre-token timeout', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockRejectedValueOnce(new Error('AbortError: request timed out')),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    await expect(
      adapter.exchangeCode({
        platform: 'threads',
        code: 'timeout_code',
        redirectUri: 'http://127.0.0.1:3000/callback',
      }),
    ).rejects.toThrow(SocialAuthOutcomeUnknownError);
  });

  it('throws SocialAuthRateLimitError on Meta 429 response', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 429,
        headers: {},
        body: JSON.stringify({
          error: { message: 'Rate limit reached', code: 4 },
        }),
      }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    await expect(
      adapter.exchangeCode({
        platform: 'threads',
        code: 'rate_limited_code',
        redirectUri: 'http://127.0.0.1:3000/callback',
      }),
    ).rejects.toThrow(SocialAuthRateLimitError);
  });

  it('refreshes long-lived access token with th_refresh_token grant', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: JSON.stringify({
          access_token: 'new_refreshed_long_token',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    const result = await adapter.refreshToken({
      accessToken: 'current_long_token_123',
    });

    expect(result.accessToken).toBe('new_refreshed_long_token');
    expect(result.tokenExpiresInSeconds).toBe(5184000);
    expect((result as unknown as { refreshToken?: unknown }).refreshToken).toBeUndefined();
  });

  it('reports unsupported for revocation without throwing or faking success', async () => {
    const adapter = new ThreadsSocialAuthAdapter(defaultOptions);
    expect(adapter.supportsRevocation).toBe(false);
    const result = await adapter.revokeToken?.('any_token');
    expect(result).toEqual({ supported: false, revoked: false });
  });

  it('redacts app secret and sensitive tokens from error messages and logs', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 400,
        headers: {},
        body: JSON.stringify({
          error: {
            message: `Invalid client_secret super-secret-threads-key-456 or token short_token_xyz`,
          },
        }),
      }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    try {
      await adapter.exchangeCode({
        platform: 'threads',
        code: 'bad_code',
        redirectUri: 'http://127.0.0.1:3000/callback',
      });
      expect.fail('Expected exchangeCode to throw');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(SocialAuthExchangeError);
      const message = (err as Error).message;
      expect(message).not.toContain('super-secret-threads-key-456');
      expect(message).not.toContain('short_token_xyz');
    }
  });
});
