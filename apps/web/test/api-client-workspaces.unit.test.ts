import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createWorkspaceApi, fetchWorkspaceDetails } from '../src/lib/api-client.js';

describe('web api-client - workspace operations', () => {
  const globalFetch = global.fetch;

  afterEach(() => {
    global.fetch = globalFetch;
    vi.restoreAllMocks();
  });

  describe('createWorkspaceApi', () => {
    it('requires a non-empty idempotency key and sends Idempotency-Key header without spoofed Origin', async () => {
      const mockCreated = {
        id: '018f4a1b-9b2e-7222-8000-000000000002',
        name: 'New WS',
        slug: 'new-ws',
        timezone: 'UTC',
        brandVoice: null,
        defaultDisclosure: null,
        aiEnabled: true,
        status: 'active',
        role: 'owner',
        createdAt: '2026-11-06T00:00:00Z',
        updatedAt: '2026-11-06T00:00:00Z',
        version: 1,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockCreated,
      });
      global.fetch = mockFetch;

      const payload = { name: 'New WS', slug: 'new-ws', timezone: 'UTC' };
      const res = await createWorkspaceApi(payload, 'idemp-key-123');

      expect(res).toEqual(mockCreated);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': 'idemp-key-123',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const headersSent = mockFetch.mock.calls[0]?.[1]?.headers;
      expect(headersSent).not.toHaveProperty('Origin');
      expect(headersSent).not.toHaveProperty('origin');
    });

    it('throws error when idempotency key is empty or whitespace', async () => {
      const payload = { name: 'New WS', slug: 'new-ws', timezone: 'UTC' };
      await expect(createWorkspaceApi(payload, '')).rejects.toThrow(
        'createWorkspaceApi requires a non-empty idempotency key',
      );
      await expect(createWorkspaceApi(payload, '   ')).rejects.toThrow(
        'createWorkspaceApi requires a non-empty idempotency key',
      );
    });

    it('rejects malformed workspace details payload', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'invalid-not-uuid', name: 'New WS' }),
      });

      await expect(
        createWorkspaceApi({ name: 'New WS', slug: 'new-ws', timezone: 'UTC' }, 'key-1'),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('fetchWorkspaceDetails', () => {
    it('returns workspace details on valid 200 payload', async () => {
      const mockWs = {
        id: '018f4a1b-9b2e-7222-8000-000000000002',
        name: 'Loaded WS',
        slug: 'loaded-ws',
        timezone: 'UTC',
        brandVoice: null,
        defaultDisclosure: null,
        aiEnabled: true,
        status: 'active',
        role: 'owner',
        createdAt: '2026-11-06T00:00:00Z',
        updatedAt: '2026-11-06T00:00:00Z',
        version: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockWs,
      });

      const res = await fetchWorkspaceDetails(mockWs.id);
      expect(res).toEqual(mockWs);
    });

    it('rejects malformed workspace response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'not-uuid' }),
      });

      await expect(fetchWorkspaceDetails('018f4a1b-9b2e-7222-8000-000000000002')).rejects.toThrow(
        ApiError,
      );
    });
  });
});
