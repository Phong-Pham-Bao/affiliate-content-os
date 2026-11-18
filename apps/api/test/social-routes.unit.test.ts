import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestSocialDeps,
  EDITOR_USER_ID,
  FOREIGN_WORKSPACE_ID,
  TEST_WORKSPACE_ID,
  VIEWER_USER_ID,
} from './helpers/social-test-deps.js';

describe('Social Connections API Routes', () => {
  const validSessionCookie = 'A'.repeat(43);
  const validOrigin = 'http://127.0.0.1:3000';

  describe('GET /api/v1/workspaces/:workspaceId/social-accounts', () => {
    it('returns 401 AUTHENTICATION_REQUIRED when session cookie is missing', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts`,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('returns 404 WORKSPACE_NOT_FOUND when user has no access to workspace', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/social-accounts`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('allows viewer role and returns empty list initially', async () => {
      const { deps, setActiveUser } = createTestSocialDeps();
      setActiveUser(VIEWER_USER_ID);
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [] });
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/social-connections/:platform/authorize', () => {
    it('returns 404 WORKSPACE_NOT_FOUND when non-owner (editor) attempts to initiate connection', async () => {
      const { deps, setActiveUser } = createTestSocialDeps();
      setActiveUser(EDITOR_USER_ID);
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': 'test-key-1',
          origin: validOrigin,
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('returns 400 when Idempotency-Key header is missing', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('MALFORMED_IDEMPOTENCY_KEY');
    });

    it('generates authorization URL and returns 200 for workspace owner', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': 'test-key-valid-1',
          origin: validOrigin,
        },
        payload: {
          returnTo: '/connections',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.authorizationUrl).toContain('/fake-social-auth?platform=threads&state=');
      expect(body.transactionId).toBeDefined();
      expect(body.expiresAt).toBeDefined();
    });

    it('replays identical authorize response for repeated Idempotency-Key', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': 'idemp-replay-key-1',
          origin: validOrigin,
        },
        payload: { returnTo: '/connections' },
      });
      expect(res1.statusCode).toBe(200);
      const body1 = res1.json();

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': 'idemp-replay-key-1',
          origin: validOrigin,
        },
        payload: { returnTo: '/connections' },
      });
      expect(res2.statusCode).toBe(200);
      const body2 = res2.json();

      expect(body2.transactionId).toBe(body1.transactionId);
      expect(body2.authorizationUrl).toBe(body1.authorizationUrl);
    });

    it('returns 409 IDEMPOTENCY_KEY_REUSED when same key is reused with different payload', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': 'idemp-mismatch-key-1',
          origin: validOrigin,
        },
        payload: { returnTo: '/connections' },
      });

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': 'idemp-mismatch-key-1',
          origin: validOrigin,
        },
        payload: { returnTo: '/other-return' },
      });
      expect(res2.statusCode).toBe(409);
      expect(res2.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('OAuth Callback and Result Flow', () => {
    it('rejects HTTP parameter pollution (duplicate query parameters)', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/social-connections/threads/callback?state=st1&state=st2&code=c1',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('OAUTH_CALLBACK_INVALID');
    });

    it('completes the full authorize -> callback -> consume result flow safely', async () => {
      const { deps } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      // 1. Authorize
      const authRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': 'flow-key-1',
          origin: validOrigin,
        },
        payload: {
          returnTo: '/connections',
        },
      });

      expect(authRes.statusCode).toBe(200);
      const { authorizationUrl } = authRes.json();
      const authUrlParsed = new URL(authorizationUrl);
      const state = authUrlParsed.searchParams.get('state');
      expect(state).not.toBeNull();

      // 2. Callback from provider
      const callbackRes = await app.inject({
        method: 'GET',
        url: `/api/v1/social-connections/threads/callback?state=${encodeURIComponent(state!)}&code=test_auth_code_123`,
      });

      expect(callbackRes.statusCode).toBe(302);
      const redirectLocation = callbackRes.headers.location;
      expect(redirectLocation).toBeDefined();
      expect(redirectLocation).toContain('/connections?connection_result=');

      const redirectUrlParsed = new URL(redirectLocation!, 'http://localhost:3000');
      const resultKey = redirectUrlParsed.searchParams.get('connection_result');
      expect(resultKey).not.toBeNull();

      // 3. Consume callback result (single-use)
      const consumeRes = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/callback-results/${resultKey}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(consumeRes.statusCode).toBe(200);
      const resultBody = consumeRes.json();
      expect(resultBody.status).toBe('success');
      expect(resultBody.platform).toBe('threads');
      expect(resultBody.socialAccountId).toBeDefined();

      // 4. Attempt to consume again fails (410 GONE)
      const reConsumeRes = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/callback-results/${resultKey}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });
      expect(reConsumeRes.statusCode).toBe(410);

      // 5. Account is now listed
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-accounts`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });
      expect(listRes.statusCode).toBe(200);
      const accounts = listRes.json().items;
      expect(accounts.length).toBe(1);
      expect(accounts[0].platform).toBe('threads');
      expect(accounts[0].status).toBe('active');
    });

    it('returns 403 FORBIDDEN when a different user in the same workspace attempts to consume result', async () => {
      const { deps, setActiveUser } = createTestSocialDeps();
      const app = createApp({ auth: deps.auth, social: deps });

      // Owner authorizes
      const authRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/threads/authorize`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          'idempotency-key': 'actor-isolation-key-1',
          origin: validOrigin,
        },
        payload: { returnTo: '/connections' },
      });
      expect(authRes.statusCode).toBe(200);
      const state = new URL(authRes.json().authorizationUrl).searchParams.get('state')!;

      // Provider callback
      const callbackRes = await app.inject({
        method: 'GET',
        url: `/api/v1/social-connections/threads/callback?state=${encodeURIComponent(state)}&code=actor_test_code`,
      });
      expect(callbackRes.statusCode).toBe(302);
      const resultKey = new URL(
        callbackRes.headers.location!,
        'http://localhost:3000',
      ).searchParams.get('connection_result')!;

      // Switch active user to EDITOR_USER_ID
      setActiveUser(EDITOR_USER_ID);

      const consumeRes = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/social-connections/callback-results/${resultKey}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(consumeRes.statusCode).toBe(403);
      expect(consumeRes.json().code).toBe('FORBIDDEN');
    });
  });
});
