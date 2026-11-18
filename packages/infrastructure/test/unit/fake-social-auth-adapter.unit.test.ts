import { describe, expect, it } from 'vitest';
import {
  SocialAuthExchangeError,
  SocialAuthRateLimitError,
} from '@affiliate-content-os/application';
import { FakeSocialAuthAdapter } from '../../src/social/index.js';

describe('FakeSocialAuthAdapter', () => {
  it('creates an allowlisted fake authorization URL with required parameters', async () => {
    const adapter = new FakeSocialAuthAdapter({
      platform: 'threads',
      authBaseUrl: 'http://localhost:3000',
      environment: 'local',
    });

    const result = await adapter.createAuthorizationUrl({
      workspaceId: '018f3a2c-4e5b-7c8d-9e0f-1a2b3c4d5e6f',
      platform: 'threads',
      state: 'mock_state_12345',
      redirectUri: 'http://127.0.0.1:3001/api/v1/social-connections/threads/callback',
      scopes: ['threads_basic', 'threads_content_publish'],
    });

    expect(result.authorizationUrl).toContain('http://localhost:3000/fake-social-auth?');
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get('platform')).toBe('threads');
    expect(url.searchParams.get('state')).toBe('mock_state_12345');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3001/api/v1/social-connections/threads/callback',
    );
    expect(url.searchParams.get('scopes')).toBe('threads_basic threads_content_publish');
    expect(url.searchParams.get('mock_env')).toBe('local');
  });

  it('exchanges code for deterministic identity, tokens, and capabilities', async () => {
    const adapter = new FakeSocialAuthAdapter({
      platform: 'threads',
      environment: 'local',
    });

    const result = await adapter.exchangeCode({
      platform: 'threads',
      code: 'code_creator_123',
      redirectUri: 'http://127.0.0.1:3001/api/v1/social-connections/threads/callback',
    });

    expect(result.providerAccountId).toMatch(/^fake_threads_user_[a-f0-9]{8}$/);
    expect(result.displayName).toBe('Fake Threads Creator');
    expect(result.handle).toMatch(/^@fake_threads_[a-f0-9]{8}$/);
    expect(result.accessToken).toMatch(/^fake_access_token_/);
    expect(result.refreshToken).toMatch(/^fake_refresh_token_/);
    expect(result.grantedScopes).toEqual(['threads_basic', 'threads_content_publish']);
    expect(result.capabilities).toEqual({ canPublishText: true, canPublishMedia: false });
    expect(result.environment).toBe('local');
  });

  it('handles simulated exchange failure', async () => {
    const adapter = new FakeSocialAuthAdapter({
      platform: 'threads',
    });

    await expect(
      adapter.exchangeCode({
        platform: 'threads',
        code: 'fail_exchange_bad_credentials',
        redirectUri: 'http://127.0.0.1:3001/api/v1/callback',
      }),
    ).rejects.toThrow(SocialAuthExchangeError);
  });

  it('handles simulated rate limit failure', async () => {
    const adapter = new FakeSocialAuthAdapter({
      platform: 'threads',
    });

    await expect(
      adapter.exchangeCode({
        platform: 'threads',
        code: 'fail_rate_limit_exceeded',
        redirectUri: 'http://127.0.0.1:3001/api/v1/callback',
      }),
    ).rejects.toThrow(SocialAuthRateLimitError);
  });
});
