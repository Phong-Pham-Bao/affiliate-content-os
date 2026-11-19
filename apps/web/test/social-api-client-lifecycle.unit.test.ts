import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginSocialReconnect,
  disconnectSocialAccount,
  refreshSocialAccount,
  SocialApiClientError,
} from '../src/lib/social-api-client.js';
import type { SocialAccountDTO } from '../src/types/social.js';

describe('Social API Client - Lifecycle Operations', () => {
  const workspaceId = '018f6c5b-21a4-789a-8def-000000000001';
  const accountId = '018f6c5b-21a4-789a-8def-000000000010';

  const mockAccount: SocialAccountDTO = {
    id: accountId,
    workspaceId,
    platform: 'threads',
    providerAccountId: 'threads_user_1',
    displayName: 'Threads Official',
    handle: 'threads_official',
    status: 'active',
    grantedScopes: ['threads_basic', 'threads_content_publish'],
    capabilities: { canPublishText: true, canPublishMedia: true, isBusinessAccount: true },
    capabilitiesCheckedAt: '2026-11-18T10:00:00.000Z',
    tokenExpiresAt: '2026-12-01T00:00:00.000Z',
    connectedByUserId: '018f6c5b-21a4-789a-8def-000000000002',
    environment: 'local',
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    version: 2,
  };

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

  it('beginSocialReconnect sends POST with Idempotency-Key and returns authorizationUrl', async () => {
    const validUrl = 'https://www.threads.com/oauth/authorize?client_id=123';
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        authorizationUrl: validUrl,
        transactionId: '018f6c5b-21a4-789a-8def-000000000030',
        expiresAt: '2026-11-18T10:10:00.000Z',
      }),
    } as unknown as Response);

    const result = await beginSocialReconnect(workspaceId, accountId, '/custom-return');
    expect(result.authorizationUrl).toBe(validUrl);
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${workspaceId}/social-accounts/${accountId}/reconnect`,
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

  it('refreshSocialAccount sends POST to refresh endpoint and returns updated account', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ...mockAccount,
        lastRefreshedAt: '2026-11-19T10:00:00.000Z',
        version: 3,
      }),
    } as unknown as Response);

    const result = await refreshSocialAccount(workspaceId, accountId);
    expect(result.version).toBe(3);
    expect(result.lastRefreshedAt).toBe('2026-11-19T10:00:00.000Z');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${workspaceId}/social-accounts/${accountId}/refresh`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Idempotency-Key': expect.any(String),
        }),
      }),
    );
  });

  it('disconnectSocialAccount sends DELETE with If-Match and returns disconnected account', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ...mockAccount,
        status: 'disconnected',
        externalRevocationResult: 'unsupported',
        version: 3,
      }),
    } as unknown as Response);

    const result = await disconnectSocialAccount(workspaceId, accountId, 2);
    expect(result.status).toBe('disconnected');
    expect(result.externalRevocationResult).toBe('unsupported');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${workspaceId}/social-accounts/${accountId}`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'If-Match': '"2"',
          'Idempotency-Key': expect.any(String),
        }),
        body: JSON.stringify({ expectedVersion: 2 }),
      }),
    );
  });

  it('disconnectSocialAccount handles 412 Precondition Failed properly', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 412,
      json: async () => ({
        code: 'PRECONDITION_FAILED',
        detail: 'Account version has changed or precondition failed.',
      }),
    } as unknown as Response);

    await expect(disconnectSocialAccount(workspaceId, accountId, 1)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SocialApiClientError &&
        err.message === 'Account version has changed or precondition failed.',
    );
  });
});
