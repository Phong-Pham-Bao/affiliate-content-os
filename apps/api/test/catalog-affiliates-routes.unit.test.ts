import { describe, expect, it, vi } from 'vitest';
import {
  parseIsoTimestamp,
  type AffiliateDestinationId,
  type ProductId,
} from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestCatalogDeps,
  TEST_WORKSPACE_ID,
  VIEWER_USER_ID,
} from './helpers/catalog-test-deps.js';
import type { InMemoryCatalogPersistence } from './helpers/in-memory-catalog-persistence.js';

describe('Catalog Affiliate Destinations Routes', () => {
  const validSessionCookie = 'A'.repeat(43);
  const validOrigin = 'http://127.0.0.1:3000';
  const testProductId = '0192b012-3456-789a-8bcd-ef0123456750' as ProductId;

  function seedProduct(persistence: InMemoryCatalogPersistence) {
    const p = {
      id: testProductId,
      workspaceId: TEST_WORKSPACE_ID,
      name: 'Smart Thermostat',
      merchantName: 'HomeClimate',
      canonicalUrl: 'https://climate.example.com/thermostat',
      canonicalUrlHash: new Uint8Array(32).fill(9),
      category: 'smarthome',
      description: 'Energy saving smart thermostat',
      audienceNotes: null,
      allowedClaimsNotes: null,
      prohibitedClaimsNotes: null,
      status: 'active' as const,
      currentFactSetId: null,
      createdAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
      version: 1,
    };
    persistence.products.set(`${TEST_WORKSPACE_ID}:${p.id}`, p);
    return p;
  }

  const validAffiliatePayload = {
    label: 'Primary Amazon Storefront',
    url: 'https://amazon.com/dp/B08N5WRWNW?tag=affiliate-20',
    networkName: 'Amazon Associates',
  };

  describe('GET /api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations', () => {
    it('returns 401 when unauthenticated', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns empty list for newly created product', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations', () => {
    it('rejects viewer role with 404 non-disclosing', async () => {
      const { deps, persistence, setActiveUser } = createTestCatalogDeps();
      seedProduct(persistence);
      setActiveUser(VIEWER_USER_ID);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456789' },
        payload: validAffiliatePayload,
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects missing Idempotency-Key header with 400', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
        payload: validAffiliatePayload,
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates affiliate destination with Location and ETag without fetching URL', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456781' },
        payload: validAffiliatePayload,
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['location']).toMatch(/\/affiliate-destinations\/[0-9a-f-]{36}$/);
      expect(res.headers['etag']).toBe('"1"');
      expect(res.json().label).toBe('Primary Amazon Storefront');
      expect(res.json().status).toBe('active');
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('PATCH /api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations/:destinationId', () => {
    it('requires If-Match header and handles version conflicts', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const createRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456782' },
        payload: validAffiliatePayload,
      });
      const destId = createRes.json().id as AffiliateDestinationId;

      const resNoMatch = await app.inject({
        method: 'PATCH',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations/${destId}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
        payload: { ...validAffiliatePayload, label: 'Updated Label' },
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
        '"1',
        '1"',
      ];

      for (const invalidHeader of invalidIfMatchValues) {
        const resInvalid = await app.inject({
          method: 'PATCH',
          url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations/${destId}`,
          cookies: { [COOKIE_SESSION]: validSessionCookie },
          headers: { origin: validOrigin, 'if-match': invalidHeader },
          payload: { ...validAffiliatePayload, label: 'Updated Label' },
        });
        expect(resInvalid.statusCode).toBe(428);
        expect(resInvalid.json().code).toBe('PRECONDITION_REQUIRED');
      }

      const resStale = await app.inject({
        method: 'PATCH',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations/${destId}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'if-match': '"99"' },
        payload: { ...validAffiliatePayload, label: 'Updated Label' },
      });
      expect(resStale.statusCode).toBe(409);

      const resOk = await app.inject({
        method: 'PATCH',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations/${destId}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'if-match': '"1"' },
        payload: { ...validAffiliatePayload, label: 'Updated Label' },
      });
      expect(resOk.statusCode).toBe(200);
      expect(resOk.headers['etag']).toBe('"2"');
      expect(resOk.json().label).toBe('Updated Label');
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/products/:productId/affiliate-destinations/:destinationId/archive', () => {
    it('archives affiliate destination idempotently', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const createRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456783' },
        payload: validAffiliatePayload,
      });
      const destId = createRes.json().id as AffiliateDestinationId;

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations/${destId}/archive`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().alreadyArchived).toBe(false);
      expect(first.json().status).toBe('archived');

      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/affiliate-destinations/${destId}/archive`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().alreadyArchived).toBe(true);
    });
  });
});
