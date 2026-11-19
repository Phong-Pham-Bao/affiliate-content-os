import { describe, expect, it } from 'vitest';
import type { SocialAccountSnapshot } from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestSocialDeps,
  EDITOR_USER_ID,
  TEST_WORKSPACE_ID,
} from './helpers/social-test-deps.js';

describe('Social Account Lifecycle API Routes', () => {
  const validSessionCookie = 'A'.repeat(43);
  const validOrigin = 'http://127.0.0.1:3000';
  const testAccountId = '018f6c5b-21a4-789a-8def-000000000010';

  const initialAccount: SocialAccountSnapshot = {
    id: testAccountId,
    workspaceId: TEST_WORKSPACE_ID,
    platform: 'threads',
    providerAccountId: 'threads_user_1',
    displayName: 'Threads Pro Creator',
    handle: '@threads_pro',
    status: 'active',
    statusReason: null,
    grantedScopes: ['threads_basic', 'threads_content_publish'],
    capabilities: { canPublishText: true, canPublishMedia: false },
    capabilitiesCheckedAt: '2026-11-19T00:00:00.000Z',
    tokenExpiresAt: '2026-12-01T00:00:00.000Z',
    reauthRequiredAt: null,
    lastRefreshedAt: '2026-11-19T00:00:00.000Z',
    nextRefreshAt: '2026-11-26T00:00:00.000Z',
    allowedActions: ['reconnect', 'refresh', 'disconnect'],
    externalRevocationSupported: false,
    externalRevocationResult: null,
    connectedByUserId: '018f6c5b-21a4-789a-8def-000000000002',
    disconnectedAt: null,
    environment: 'local',
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
    version: 1,
  };

  describe('POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/reconnect', () => {
    it('returns 401 when session cookie is missing', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts/${testAccountId}/reconnect`,
        headers: { origin: validOrigin, 'idempotency-key': 'reconnect-key-1' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('returns 404 when non-owner (editor) attempts to reconnect', async () => {
      const { deps, setActiveUser } = createTestSocialDeps();
      setActiveUser(EDITOR_USER_ID);
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts/${testAccountId}/reconnect`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': 'reconnect-key-2' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('generates reconnect authorization URL for owner', async () => {
      const { deps, persistence } = createTestSocialDeps();
      persistence.accounts.set(initialAccount.id, initialAccount);
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts/${testAccountId}/reconnect`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': 'reconnect-key-3' },
        payload: { returnTo: '/connections' },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.authorizationUrl).toContain('/fake-social-auth?');
      expect(json.transactionId).toBeDefined();
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/social-accounts/:accountId/refresh', () => {
    it('returns 401 when unauthenticated', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts/${testAccountId}/refresh`,
        headers: { origin: validOrigin, 'idempotency-key': 'refresh-key-1' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 404 when account does not exist in workspace', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts/${testAccountId}/refresh`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': 'refresh-key-2' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('refreshes social account for owner and updates version', async () => {
      const { deps, persistence } = createTestSocialDeps();
      persistence.accounts.set(initialAccount.id, initialAccount);
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts/${testAccountId}/refresh`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': 'refresh-key-3' },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.id).toBe(testAccountId);
      expect(json.version).toBe(2);
      expect(json.lastRefreshedAt).toBeDefined();
    });
  });

  describe('DELETE /api/v1/workspaces/:workspaceId/social-accounts/:accountId', () => {
    it('returns 412 when If-Match version does not match current version', async () => {
      const { deps, persistence } = createTestSocialDeps();
      persistence.accounts.set(initialAccount.id, initialAccount);
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts/${testAccountId}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': 'disconnect-key-1',
          'if-match': '"999"',
        },
      });

      expect(res.statusCode).toBe(412);
      expect(res.json().code).toBe('PRECONDITION_FAILED');
    });

    it('disconnects social account when If-Match matches version', async () => {
      const { deps, persistence } = createTestSocialDeps();
      persistence.accounts.set(initialAccount.id, initialAccount);
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts/${testAccountId}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': 'disconnect-key-2',
          'if-match': '"1"',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.status).toBe('disconnected');
      expect(json.version).toBe(2);
      expect(json.externalRevocationResult).toBe('unsupported');
    });
  });
});
