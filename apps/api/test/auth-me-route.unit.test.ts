import { describe, expect, it } from 'vitest';
import type { UserDirectoryPort } from '@affiliate-content-os/application';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import { createMockAuthDeps, createTestAuthConfig } from './helpers/auth-test-fakes.js';

describe('GET /api/v1/me route', { timeout: 15000 }, () => {
  const validSessionCookie = 'A'.repeat(43);

  it('returns 503 AUTH_NOT_CONFIGURED when auth is disabled', async () => {
    const auth = createMockAuthDeps({ config: createTestAuthConfig({ enabled: false }) });
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('returns 401 AUTHENTICATION_REQUIRED and clears session cookie when cookie is missing', async () => {
    const auth = createMockAuthDeps();
    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('AUTHENTICATION_REQUIRED');

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${COOKIE_SESSION}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('returns 401 AUTHENTICATION_REQUIRED and clears session cookie when session is expired or revoked', async () => {
    const auth = createMockAuthDeps();
    // Return empty candidate sessions => not found / expired / revoked
    auth.sessionStore.findCandidateSessions = async () => [];

    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: {
        [COOKIE_SESSION]: validSessionCookie,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('AUTHENTICATION_REQUIRED');

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${COOKIE_SESSION}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('returns 200 with user, session, and workspaceAccess on valid session', async () => {
    const auth = createMockAuthDeps();
    const userId = '0192b012-3456-789a-8bcd-ef0123456789';

    // Mock active session in sessionStore
    auth.sessionStore.findCandidateSessions = async () => [
      {
        id: '0192b012-3456-789a-8bcd-ef0123456720',
        userId,
        currentTokenHash: new Uint8Array(32).fill(7),
        previousTokenHash: null,
        previousTokenValidUntil: null,
        createdAt: '2026-11-02T12:00:00.000Z',
        lastSeenAt: '2026-11-02T12:00:00.000Z',
        idleExpiresAt: '2026-11-02T12:30:00.000Z',
        absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
        rotatedAt: '2026-11-02T12:00:00.000Z',
        revokedAt: null,
        revocationReason: null,
        version: 1,
      },
    ];

    type UserRecord = NonNullable<Awaited<ReturnType<UserDirectoryPort['findUserById']>>>;

    // Mock active user in sessionStore
    auth.sessionStore.findUserById = async () =>
      Object.freeze({
        id: userId as unknown as UserRecord['id'],
        identityProvider: 'https://auth.example.com',
        identitySubject: 'sub-123',
        email: 'user@example.com',
        displayName: 'Test User',
        status: 'active',
        createdAt: '2026-11-02T12:00:00.000Z' as unknown as UserRecord['createdAt'],
        updatedAt: '2026-11-02T12:00:00.000Z' as unknown as UserRecord['updatedAt'],
        version: 1,
      });

    // Mock workspace summaries
    auth.workspaceSummary.listActiveWorkspaceSummaries = async () =>
      Object.freeze({
        items: [
          Object.freeze({
            id: '0192b012-3456-789a-8bcd-ef0123456799',
            name: 'Workspace Alpha',
            slug: 'alpha',
            timezone: 'Asia/Ho_Chi_Minh',
            role: 'owner' as const,
          }),
        ],
        hasMore: false,
      });

    const app = createApp({ auth });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: {
        [COOKIE_SESSION]: validSessionCookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['pragma']).toBe('no-cache');
    expect(response.headers['referrer-policy']).toBe('no-referrer');

    const body = response.json();
    expect(body.user).toEqual({
      id: userId,
      email: 'user@example.com',
      displayName: 'Test User',
    });
    expect(body.session).toEqual({
      idleExpiresAt: '2026-11-02T12:30:00.000Z',
      absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
    });
    expect(body.workspaceAccess).toEqual({
      items: [
        {
          id: '0192b012-3456-789a-8bcd-ef0123456799',
          name: 'Workspace Alpha',
          slug: 'alpha',
          timezone: 'Asia/Ho_Chi_Minh',
          role: 'owner',
        },
      ],
      hasMore: false,
    });

    // Regression check: preserve exact existing GET /api/v1/me contract
    expect(body.user).not.toHaveProperty('status');
    expect(body.session).not.toHaveProperty('id');
    expect(body.workspaceAccess).not.toHaveProperty('workspaces');
    expect(body.workspaceAccess).not.toHaveProperty('workspaceId');
  });
});
