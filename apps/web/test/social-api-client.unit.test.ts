import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginSocialAuthorize,
  fetchCallbackResult,
  fetchSocialAccounts,
  SocialApiClientError,
} from '../src/lib/social-api-client.js';
import type { SocialAccountDTO } from '../src/types/social.js';

describe('Social API Client', () => {
  const workspaceId = '018f6c5b-21a4-789a-8def-000000000001';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', {
      location: {
        pathname: '/connections',
        origin: 'http://localhost:3000',
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchSocialAccounts sends GET request and returns items list', async () => {
    const mockAccounts: readonly SocialAccountDTO[] = [
      {
        id: '018f6c5b-21a4-789a-8def-000000000010',
        workspaceId,
        platform: 'threads',
        providerAccountId: 'threads_user_1',
        displayName: 'Affiliate Master',
        handle: 'affiliate_master',
        status: 'active',
        grantedScopes: ['threads_basic', 'threads_content_publish'],
        capabilities: { canPublishText: true, canPublishMedia: true, isBusinessAccount: true },
        capabilitiesCheckedAt: '2026-11-18T10:00:00.000Z',
        tokenExpiresAt: '2026-12-01T00:00:00.000Z',
        connectedByUserId: '018f6c5b-21a4-789a-8def-000000000002',
        environment: 'local',
        createdAt: '2026-11-18T10:00:00.000Z',
        updatedAt: '2026-11-18T10:00:00.000Z',
        version: 1,
      },
    ];

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ items: mockAccounts }),
    } as unknown as Response);

    const items = await fetchSocialAccounts(workspaceId);
    expect(items).toHaveLength(1);
    expect(items[0]?.handle).toBe('affiliate_master');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${workspaceId}/social-accounts`,
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('beginSocialAuthorize sends POST with Idempotency-Key and returns authorizationUrl', async () => {
    const validUrl = 'http://localhost:3000/fake-social-auth?state=xyz';
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        authorizationUrl: validUrl,
        transactionId: '018f6c5b-21a4-789a-8def-000000000030',
        expiresAt: '2026-11-18T10:10:00.000Z',
      }),
    } as unknown as Response);

    const result = await beginSocialAuthorize(workspaceId, 'threads', '/custom-return');
    expect(result.authorizationUrl).toBe(validUrl);
    expect(result.transactionId).toBe('018f6c5b-21a4-789a-8def-000000000030');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${workspaceId}/social-connections/threads/authorize`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': expect.any(String),
        }),
        body: JSON.stringify({ returnTo: '/custom-return' }),
      }),
    );
  });

  it('beginSocialAuthorize throws on invalid authorizationUrl', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        authorizationUrl: 'javascript:alert(1)',
        transactionId: '018f6c5b-21a4-789a-8def-000000000030',
        expiresAt: '2026-11-18T10:10:00.000Z',
      }),
    } as unknown as Response);

    await expect(beginSocialAuthorize(workspaceId, 'threads')).rejects.toThrow(
      SocialApiClientError,
    );
  });

  it('fetchCallbackResult retrieves callback result status', async () => {
    const resultKey = 'res_test123';
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: '018f6c5b-21a4-789a-8def-000000000020',
        status: 'success',
        platform: 'tiktok',
        socialAccountId: '018f6c5b-21a4-789a-8def-000000000010',
        errorCode: null,
        errorDescription: null,
      }),
    } as unknown as Response);

    const result = await fetchCallbackResult(workspaceId, resultKey);
    expect(result.status).toBe('success');
    expect(result.platform).toBe('tiktok');
    expect(result.socialAccountId).toBe('018f6c5b-21a4-789a-8def-000000000010');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${workspaceId}/social-connections/callback-results/${resultKey}`,
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('throws SocialApiClientError with details when response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        code: 'INSUFFICIENT_PERMISSIONS',
        detail: 'Chỉ Owner mới có quyền kết nối tài khoản mạng xã hội.',
      }),
    } as unknown as Response);

    await expect(fetchSocialAccounts(workspaceId)).rejects.toThrow(
      'Chỉ Owner mới có quyền kết nối tài khoản mạng xã hội.',
    );
  });
});
