import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createWorkspaceApi,
  fetchCurrentUser,
  fetchWorkspaceDetails,
  logoutUser,
} from '../src/lib/api-client.js';

function jsonRes(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
  };
}

describe('Web Application Browser & State Transitions Flow', () => {
  const globalFetch = global.fetch;

  afterEach(() => {
    global.fetch = globalFetch;
    vi.restoreAllMocks();
  });

  it('flow 1: unauthenticated user visits -> 401 returns null -> signed-out state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/problem+json' }),
      json: async () => ({ code: 'AUTHENTICATION_REQUIRED' }),
    });

    const user = await fetchCurrentUser();
    expect(user).toBeNull();
  });

  it('flow 2: authenticated user with 0 workspaces sees onboarding, creates first workspace', async () => {
    const initialUserResponse = {
      user: {
        id: '018f4a1b-9b2e-7111-8000-000000000001',
        email: 'owner@example.com',
        displayName: 'Workspace Owner',
      },
      session: {
        idleExpiresAt: '2026-11-06T15:00:00Z',
        absoluteExpiresAt: '2026-11-06T23:00:00Z',
      },
      workspaceAccess: { items: [], hasMore: false },
    };

    const newWorkspace = {
      id: '018f4a1b-9b2e-7222-8000-000000000002',
      name: 'First Workspace',
      slug: 'first-workspace',
      timezone: 'UTC',
      brandVoice: 'Authoritative',
      defaultDisclosure: null,
      aiEnabled: true,
      status: 'active',
      role: 'owner',
      createdAt: '2026-11-06T00:00:00Z',
      updatedAt: '2026-11-06T00:00:00Z',
      version: 1,
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/v1/me') return jsonRes(initialUserResponse);
      if (url === '/api/v1/workspaces') return jsonRes(newWorkspace, 201);
      throw new Error(`Unexpected url: ${url}`);
    });

    const userRes = await fetchCurrentUser();
    expect(userRes).not.toBeNull();
    expect(userRes?.workspaceAccess.items).toHaveLength(0);

    const created = await createWorkspaceApi(
      {
        name: 'First Workspace',
        slug: 'first-workspace',
        timezone: 'UTC',
        brandVoice: 'Authoritative',
      },
      '018f4a1b-9b2e-7999-8000-000000000099',
    );

    expect(created.id).toBe(newWorkspace.id);
    expect(created.slug).toBe('first-workspace');
    expect(created.role).toBe('owner');
  });

  it('flow 3: user switches workspaces, loads details, then logs out with 204', async () => {
    const ws1 = {
      id: '018f4a1b-9b2e-7222-8000-000000000002',
      name: 'Workspace One',
      slug: 'workspace-one',
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
    const ws2 = {
      ...ws1,
      id: '018f4a1b-9b2e-7333-8000-000000000003',
      name: 'WS Two',
      role: 'editor',
    };

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (url === `/api/v1/workspaces/${ws1.id}`) return jsonRes(ws1);
      if (url === `/api/v1/workspaces/${ws2.id}`) return jsonRes(ws2);
      if (url === '/api/v1/logout' && opts?.method === 'POST') return { ok: true, status: 204 };
      throw new Error(`Unexpected url: ${url}`);
    });

    const details1 = await fetchWorkspaceDetails(ws1.id);
    expect(details1.name).toBe('Workspace One');
    const details2 = await fetchWorkspaceDetails(ws2.id);
    expect(details2.name).toBe('WS Two');

    await expect(logoutUser()).resolves.toBeUndefined();
  });

  it('flow 4: workspace detail failure returns ApiError while preserving caller session state', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/workspaces/')) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'application/problem+json' }),
          json: async () => ({
            status: 500,
            title: 'Internal Server Error',
            detail: 'Database connection failed',
          }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    await expect(fetchWorkspaceDetails('018f4a1b-9b2e-7222-8000-000000000002')).rejects.toThrow(
      ApiError,
    );
  });

  it('flow 5: logout failure rejects with ApiError, allowing AppShell to preserve signed-in state', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/v1/logout') {
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers({ 'content-type': 'application/problem+json' }),
          json: async () => ({
            status: 403,
            title: 'Origin Untrusted',
            detail: 'Invalid origin header',
          }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    await expect(logoutUser()).rejects.toThrow(ApiError);
  });

  it('flow 6: authentication service unavailable triggers recoverable 503 error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ 'content-type': 'application/problem+json' }),
      json: async () => ({
        code: 'AUTH_NOT_CONFIGURED',
        detail: 'OIDC provider unavailable',
      }),
    });

    await expect(fetchCurrentUser()).rejects.toThrow(ApiError);
  });
});
