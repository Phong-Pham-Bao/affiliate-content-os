import { describe, expect, it, vi } from 'vitest';
import {
  SocialAuthExchangeError,
  SocialAuthOutcomeUnknownError,
  SocialAuthRateLimitError,
  SocialAuthTerminalError,
} from '@affiliate-content-os/application';
import { ThreadsSocialAuthAdapter, type HttpTransport } from '../../src/social/index.js';

describe('ThreadsSocialAuthAdapter', () => {
  const defaultOptions = {
    appId: 'threads-app-123',
    appSecret: 'super-secret-threads-key-456',
    authBaseUrl: 'https://www.threads.com',
    apiBaseUrl: 'https://graph.threads.com',
    apiVersion: 'v1.0',
    metaGraphBaseUrl: 'https://graph.facebook.com',
    metaGraphVersion: 'v21.0',
    appAccessToken: 'test_app_token_injected',
    timeoutMs: 5000,
    environment: 'local' as const,
  };

  it('generates official Threads authorization URL with standard parameters on www.threads.com', async () => {
    const adapter = new ThreadsSocialAuthAdapter(defaultOptions);
    const result = await adapter.createAuthorizationUrl({
      workspaceId: '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f',
      platform: 'threads',
      state: 'random_state_abc123',
      redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
      scopes: ['threads_basic', 'threads_content_publish'],
    });

    expect(result.authorizationUrl).toContain('https://www.threads.com/oauth/authorize?');
    const url = new URL(result.authorizationUrl);
    expect(url.hostname).toBe('www.threads.com');
    expect(url.searchParams.get('client_id')).toBe('threads-app-123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('threads_basic,threads_content_publish');
    expect(url.searchParams.get('state')).toBe('random_state_abc123');
  });

  it('rejects unexpected or missing scopes during createAuthorizationUrl', async () => {
    const adapter = new ThreadsSocialAuthAdapter(defaultOptions);
    await expect(
      adapter.createAuthorizationUrl({
        workspaceId: '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f',
        platform: 'threads',
        state: 'random_state_abc123',
        redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
        scopes: ['threads_basic', 'malicious_extra_scope'],
      }),
    ).rejects.toThrow(SocialAuthExchangeError);

    await expect(
      adapter.createAuthorizationUrl({
        workspaceId: '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f',
        platform: 'threads',
        state: 'random_state_abc123',
        redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
        scopes: ['threads_basic'], // Missing threads_content_publish
      }),
    ).rejects.toThrow(SocialAuthExchangeError);

    await expect(
      adapter.createAuthorizationUrl({
        workspaceId: '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f',
        platform: 'threads',
        state: 'random_state_abc123',
        redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
        scopes: [],
      }),
    ).rejects.toThrow(SocialAuthExchangeError);

    await expect(
      adapter.createAuthorizationUrl({
        workspaceId: '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f',
        platform: 'threads',
        state: 'random_state_abc123',
        redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
        scopes: ['threads_basic', 'threads_content_publish', 'threads_basic'],
      }),
    ).rejects.toThrow(SocialAuthExchangeError);
  });

  it('exchanges authorization code through staged pipeline to long-lived token and profile', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi
        .fn()
        // 1. Short token exchange
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            access_token: 'short_token_xyz',
            user_id: 'threads_user_999',
          }),
        })
        // 2. Long token exchange
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            access_token: 'long_token_abc',
            token_type: 'bearer',
            expires_in: 5184000,
          }),
        })
        // 3. Profile lookup
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'threads_user_999',
            username: 'threads_creator_pro',
            name: 'Threads Creator Pro',
          }),
        })
        // 4. Meta debug_token lookup
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              app_id: 'threads-app-123',
              user_id: 'threads_user_999',
              is_valid: true,
              scopes: ['threads_basic', 'threads_content_publish'],
              expires_at: 1735689600,
            },
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
    expect(result.stage).toBe('completed');
  });

  it('throws terminal error if profile ID does not match token exchange user ID', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi
        .fn()
        // 1. Short token exchange
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            access_token: 'short_token_xyz',
            user_id: 'expected_user_111',
          }),
        })
        // 2. Long token exchange
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            access_token: 'long_token_abc',
            expires_in: 5184000,
          }),
        })
        // 3. Profile lookup returns a DIFFERENT id!
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'different_user_222',
            username: 'imposter',
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
        code: 'valid_auth_code_123',
        redirectUri: 'http://127.0.0.1:3000/api/v1/social-connections/threads/callback',
      }),
    ).rejects.toThrow(SocialAuthExchangeError);
  });

  it('does not fabricate threads_content_publish when permissions inspection fails or omits it', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi
        .fn()
        // 1. Short token
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'short_tok', user_id: 'user_123' }),
        })
        // 2. Long token
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'long_tok', expires_in: 5184000 }),
        })
        // 3. Profile
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'user_123', username: 'real_user' }),
        })
        // 4. Permissions lookup returns 500 error
        .mockResolvedValueOnce({
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: { message: 'Permissions service unavailable' } }),
        }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    const result = await adapter.exchangeCode({
      platform: 'threads',
      code: 'valid_code',
      redirectUri: 'http://127.0.0.1:3000/callback',
    });

    expect(result.grantedScopes).not.toContain('threads_content_publish');
    expect(result.capabilities.canPublishText).toBe(false);
    expect(result.isRecoverablePartial).toBe(true);
    expect(result.stage).not.toBe('completed');
  });

  it('returns recoverable partial result without fabricated display name when profile lookup fails', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'short_token_xyz', user_id: 'threads_user_999' }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'long_token_abc', expires_in: 5184000 }),
        })
        .mockResolvedValueOnce({
          status: 500,
          headers: { 'content-type': 'application/json' },
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
    expect(result.displayName).toBe('threads_user_999'); // Not fabricated "Threads User ..."
    expect(result.stage).toBe('long_token_exchanged');
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
        headers: { 'retry-after': '120', 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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
        headers: { 'content-type': 'application/json' },
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

  it('rejects oversized IDs and IDs with control characters', async () => {
    const oversizedId = 'a'.repeat(129);
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ access_token: 'short_tok', user_id: oversizedId }),
      }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    await expect(
      adapter.exchangeCode({
        platform: 'threads',
        code: 'valid_code',
        redirectUri: 'http://127.0.0.1:3000/callback',
      }),
    ).rejects.toThrow(SocialAuthExchangeError);

    const controlId = 'bad\x00user\nid';
    const mockTransportControl: HttpTransport = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ access_token: 'short_tok', user_id: controlId }),
      }),
    };

    const adapterControl = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransportControl,
    });

    await expect(
      adapterControl.exchangeCode({
        platform: 'threads',
        code: 'valid_code',
        redirectUri: 'http://127.0.0.1:3000/callback',
      }),
    ).rejects.toThrow(SocialAuthExchangeError);
  });

  it('rejects non-positive or non-integer expires_in', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'short_tok', user_id: 'user_123' }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'long_tok', expires_in: -10 }),
        }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    await expect(
      adapter.exchangeCode({
        platform: 'threads',
        code: 'valid_code',
        redirectUri: 'http://127.0.0.1:3000/callback',
      }),
    ).rejects.toThrow(SocialAuthExchangeError);
  });

  it('handles permission inspection variations: only basic, only publish, empty data, duplicates', async () => {
    // 1. Only basic returned
    const mockTransportBasic: HttpTransport = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'short_tok', user_id: 'user_123' }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'long_tok', expires_in: 5184000 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'user_123', username: 'user_basic' }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              app_id: 'threads-app-123',
              user_id: 'user_123',
              is_valid: true,
              scopes: ['threads_basic'],
            },
          }),
        }),
    };

    const adapterBasic = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransportBasic,
    });

    const resBasic = await adapterBasic.exchangeCode({
      platform: 'threads',
      code: 'code1',
      redirectUri: 'http://localhost/cb',
    });
    expect(resBasic.grantedScopes).toEqual(['threads_basic']);
    expect(resBasic.capabilities.canPublishText).toBe(false);
    expect(resBasic.isRecoverablePartial).toBe(true);

    // 2. Only publish returned (with duplicates and unknown items)
    const mockTransportPublish: HttpTransport = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'short_tok', user_id: 'user_123' }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'long_tok', expires_in: 5184000 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'user_123', username: 'user_pub' }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              app_id: 'threads-app-123',
              user_id: 'user_123',
              is_valid: true,
              scopes: [
                'threads_content_publish',
                'threads_content_publish',
                'unknown_special_scope',
              ],
            },
          }),
        }),
    };

    const adapterPublish = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransportPublish,
    });

    const resPublish = await adapterPublish.exchangeCode({
      platform: 'threads',
      code: 'code2',
      redirectUri: 'http://localhost/cb',
    });
    expect(resPublish.grantedScopes).toEqual(['threads_content_publish']);
    expect(resPublish.capabilities.canPublishText).toBe(false);
    expect(resPublish.isRecoverablePartial).toBe(true);

    // 3. Empty data array
    const mockTransportEmpty: HttpTransport = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'short_tok', user_id: 'user_123' }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'long_tok', expires_in: 5184000 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'user_123', username: 'user_empty' }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              app_id: 'threads-app-123',
              user_id: 'user_123',
              is_valid: true,
              scopes: [],
            },
          }),
        }),
    };

    const adapterEmpty = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransportEmpty,
    });

    const resEmpty = await adapterEmpty.exchangeCode({
      platform: 'threads',
      code: 'code3',
      redirectUri: 'http://localhost/cb',
    });
    expect(resEmpty.grantedScopes).toEqual([]);
    expect(resEmpty.capabilities.canPublishText).toBe(false);
    expect(resEmpty.isRecoverablePartial).toBe(true);
  });

  it('inspectCurrentAccount inspects live profile and permissions', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'threads_user_777',
            username: 'inspected_user',
            name: 'Inspected Account',
          }),
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              app_id: 'threads-app-123',
              user_id: 'threads_user_777',
              is_valid: true,
              scopes: ['threads_basic', 'threads_content_publish'],
            },
          }),
        }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    const result = await adapter.inspectCurrentAccount?.({
      accessToken: 'valid_access_token_777',
    });

    expect(result).toBeDefined();
    expect(result?.providerAccountId).toBe('threads_user_777');
    expect(result?.handle).toBe('@inspected_user');
    expect(result?.displayName).toBe('Inspected Account');
    expect(result?.grantedScopes).toEqual(['threads_basic', 'threads_content_publish']);
    expect(result?.capabilities).toEqual({ canPublishText: true, canPublishMedia: false });
  });

  it('inspectCurrentAccount throws on upstream error', async () => {
    const mockTransport: HttpTransport = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 401,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: { message: 'Invalid OAuth 2.0 Access Token', code: 190 },
        }),
      }),
    };

    const adapter = new ThreadsSocialAuthAdapter({
      ...defaultOptions,
      transport: mockTransport,
    });

    await expect(
      adapter.inspectCurrentAccount?.({
        accessToken: 'expired_invalid_token',
      }),
    ).rejects.toThrow(SocialAuthTerminalError);
  });
});
