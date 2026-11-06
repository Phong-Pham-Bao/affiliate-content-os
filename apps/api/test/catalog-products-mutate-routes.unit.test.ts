import { describe, expect, it, vi } from 'vitest';
import { parseIsoTimestamp, type ProductId } from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestCatalogDeps,
  TEST_WORKSPACE_ID,
  VIEWER_USER_ID,
} from './helpers/catalog-test-deps.js';

describe('Catalog Products Mutate Routes', () => {
  const validSessionCookie = 'A'.repeat(43);
  const validOrigin = 'http://127.0.0.1:3000';

  const validProductPayload = {
    name: 'Ergonomic Desk Chair',
    merchantName: 'OfficePro',
    canonicalUrl: 'https://officepro.example.com/products/desk-chair',
    category: 'furniture',
    description: 'High quality ergonomic lumbar support chair.',
    audienceNotes: 'Remote workers',
    allowedClaimsNotes: 'Holds up to 300 lbs',
    prohibitedClaimsNotes: 'Do not claim medical cure',
  };

  describe('POST /api/v1/workspaces/:workspaceId/products', () => {
    it('returns 404 non-disclosing when user is in viewer role', async () => {
      const { deps, setActiveUser } = createTestCatalogDeps();
      setActiveUser(VIEWER_USER_ID);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456789',
        },
        payload: validProductPayload,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('returns 403 when Origin header is invalid', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: 'https://malicious-site.example.com',
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456789',
        },
        payload: validProductPayload,
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when Idempotency-Key header is missing or empty', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
        payload: validProductPayload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('MALFORMED_IDEMPOTENCY_KEY');
    });

    it('returns 400 when body contains unknown fields (additionalProperties: false)', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456789',
        },
        payload: { ...validProductPayload, extraUnknownProperty: 'malicious' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('creates draft product successfully with Location, ETag, and duplicateWarning false', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456789',
        },
        payload: validProductPayload,
      });

      expect(res.statusCode).toBe(201);
      expect(res.headers['location']).toMatch(/\/products\/[0-9a-f-]{36}$/);
      expect(res.headers['etag']).toBe('"1"');
      const body = res.json();
      expect(body.duplicateWarning).toBe(false);
      expect(body.name).toBe('Ergonomic Desk Chair');
      expect(body.status).toBe('draft');
      expect(body.version).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('returns duplicateWarning true when canonical URL already exists in workspace', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456781',
        },
        payload: validProductPayload,
      });
      expect(res1.statusCode).toBe(201);
      expect(res1.json().duplicateWarning).toBe(false);

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: {
          origin: validOrigin,
          'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456782',
        },
        payload: { ...validProductPayload, name: 'Different Name But Same URL' },
      });
      expect(res2.statusCode).toBe(201);
      expect(res2.json().duplicateWarning).toBe(true);
    });

    it('returns cached response on identical idempotency key and 409 on reused key with different payload', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });
      const idempKey = '0192b012-3456-789a-8bcd-ef0123456799';

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': idempKey },
        payload: validProductPayload,
      });
      expect(first.statusCode).toBe(201);

      const replay = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': idempKey },
        payload: {
          name: '  Ergonomic Desk Chair  ',
          merchantName: '  OfficePro  ',
          canonicalUrl: 'HTTPS://OFFICEPRO.EXAMPLE.COM:443/products/desk-chair',
          category: '  furniture  ',
          description: '  High quality ergonomic lumbar support chair.  ',
          audienceNotes: '  Remote workers  ',
          allowedClaimsNotes: '  Holds up to 300 lbs  ',
          prohibitedClaimsNotes: '  Do not claim medical cure  ',
        },
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.json().id).toBe(first.json().id);

      const mismatch = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': idempKey },
        payload: { ...validProductPayload, name: 'Mutated Request Body' },
      });
      expect(mismatch.statusCode).toBe(409);
      expect(mismatch.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('PATCH /api/v1/workspaces/:workspaceId/products/:productId', () => {
    it('requires valid positive integer If-Match header', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const resNoMatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/0192b012-3456-789a-8bcd-ef0123456755`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
        payload: validProductPayload,
      });
      expect(resNoMatch.statusCode).toBe(428);
      expect(resNoMatch.json().code).toBe('PRECONDITION_REQUIRED');

      const invalidIfMatchValues = [
        '1',
        'W/"1"',
        '*',
        '"1","2"',
        '"0"',
        '"9007199254740992"',
        '"1, 1"',
        '"1',
        '1"',
      ];

      for (const invalidHeader of invalidIfMatchValues) {
        const resBadMatch = await app.inject({
          method: 'PATCH',
          url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/0192b012-3456-789a-8bcd-ef0123456755`,
          cookies: { [COOKIE_SESSION]: validSessionCookie },
          headers: { origin: validOrigin, 'if-match': invalidHeader },
          payload: validProductPayload,
        });
        expect(resBadMatch.statusCode).toBe(428);
        expect(resBadMatch.json().code).toBe('PRECONDITION_REQUIRED');
      }
    });

    it('returns 409 STALE_VERSION_CONFLICT on version mismatch and 200 on matching version', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const p = {
        id: '0192b012-3456-789a-8bcd-ef0123456755' as ProductId,
        workspaceId: TEST_WORKSPACE_ID,
        name: 'Initial Chair',
        merchantName: 'Store',
        canonicalUrl: 'https://example.com/chair',
        canonicalUrlHash: new Uint8Array(32).fill(1),
        category: 'furniture',
        description: 'Initial description',
        audienceNotes: null,
        allowedClaimsNotes: null,
        prohibitedClaimsNotes: null,
        status: 'draft' as const,
        currentFactSetId: null,
        createdAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
        version: 2,
      };
      persistence.products.set(`${TEST_WORKSPACE_ID}:${p.id}`, p);

      const resStale = await app.inject({
        method: 'PATCH',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${p.id}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'if-match': '"1"' },
        payload: { ...validProductPayload, name: 'Updated Name' },
      });
      expect(resStale.statusCode).toBe(409);
      expect(resStale.json().code).toBe('STALE_VERSION_CONFLICT');

      const resOk = await app.inject({
        method: 'PATCH',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${p.id}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'if-match': '"2"' },
        payload: { ...validProductPayload, name: 'Updated Name' },
      });
      expect(resOk.statusCode).toBe(200);
      expect(resOk.headers['etag']).toBe('"3"');
      expect(resOk.json().name).toBe('Updated Name');
      expect(resOk.json().version).toBe(3);
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/products/:productId/archive', () => {
    it('archives product idempotently returning alreadyArchived false then true', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const p = {
        id: '0192b012-3456-789a-8bcd-ef0123456756' as ProductId,
        workspaceId: TEST_WORKSPACE_ID,
        name: 'To Archive',
        merchantName: 'Store',
        canonicalUrl: 'https://example.com/chair-archive',
        canonicalUrlHash: new Uint8Array(32).fill(1),
        category: 'furniture',
        description: 'To archive',
        audienceNotes: null,
        allowedClaimsNotes: null,
        prohibitedClaimsNotes: null,
        status: 'draft' as const,
        currentFactSetId: null,
        createdAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
        version: 1,
      };
      persistence.products.set(`${TEST_WORKSPACE_ID}:${p.id}`, p);

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${p.id}/archive`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().alreadyArchived).toBe(false);
      expect(first.json().status).toBe('archived');

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${p.id}/archive`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().alreadyArchived).toBe(true);
      expect(second.json().status).toBe('archived');
    });
  });
});
