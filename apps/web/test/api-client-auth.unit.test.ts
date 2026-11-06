import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchCurrentUser, logoutUser } from '../src/lib/api-client.js';

describe('web api-client - auth operations', () => {
  const globalFetch = global.fetch;

  afterEach(() => {
    global.fetch = globalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchCurrentUser', () => {
    it('returns user response on valid 200 payload matching exact contract', async () => {
      const mockData = {
        user: {
          id: '018f4a1b-9b2e-7111-8000-000000000001',
          email: 'test@example.com',
          displayName: 'Test',
        },
        session: {
          idleExpiresAt: '2026-11-06T12:00:00Z',
          absoluteExpiresAt: '2026-11-06T20:00:00Z',
        },
        workspaceAccess: {
          items: [
            {
              id: '018f4a1b-9b2e-7222-8000-000000000002',
              name: 'Workspace Alpha',
              slug: 'workspace-alpha',
              timezone: 'America/New_York',
              role: 'owner',
            },
          ],
          hasMore: false,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockData,
      });

      const result = await fetchCurrentUser();
      expect(result).toEqual(mockData);
    });

    it('returns null on 401 unauthenticated', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/problem+json' }),
        json: async () => ({ code: 'AUTHENTICATION_REQUIRED' }),
      });

      const result = await fetchCurrentUser();
      expect(result).toBeNull();
    });

    it('throws ApiError on 503 AUTH_NOT_CONFIGURED', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ 'content-type': 'application/problem+json' }),
        json: async () => ({
          code: 'AUTH_NOT_CONFIGURED',
          detail: 'Auth not configured.',
        }),
      });

      await expect(fetchCurrentUser()).rejects.toThrow(ApiError);
    });

    it('rejects malformed success JSON containing user.status or session.id', async () => {
      const invalidWithStatus = {
        user: {
          id: '018f4a1b-9b2e-7111-8000-000000000001',
          email: 'test@example.com',
          displayName: 'Test',
          status: 'active',
        },
        session: {
          idleExpiresAt: '2026-11-06T12:00:00Z',
          absoluteExpiresAt: '2026-11-06T20:00:00Z',
        },
        workspaceAccess: { items: [], hasMore: false },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => invalidWithStatus,
      });

      await expect(fetchCurrentUser()).rejects.toThrow(ApiError);
    });

    it('fails safely when response is non-JSON or malformed JSON', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      });

      await expect(fetchCurrentUser()).rejects.toThrow(ApiError);
    });
  });

  describe('logoutUser', () => {
    it('succeeds on HTTP 204 No Content', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
      global.fetch = mockFetch;

      await expect(logoutUser()).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/logout',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });

    it('rejects unexpected 2xx success statuses (e.g. 200 OK)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'ok' }),
      });

      await expect(logoutUser()).rejects.toThrow(ApiError);
    });

    it('parses and throws safe ApiError on non-2xx problem response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({ 'content-type': 'application/problem+json' }),
        json: async () => ({
          status: 403,
          title: 'Origin Untrusted',
          detail: 'Request origin is invalid',
        }),
      });

      const err = await logoutUser().catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(403);
      expect(err.problem.detail).toBe('Request origin is invalid');
    });
  });
});
