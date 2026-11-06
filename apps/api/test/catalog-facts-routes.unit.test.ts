import { describe, expect, it } from 'vitest';
import {
  parseIsoTimestamp,
  type ProductFactSetId,
  type ProductId,
} from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestCatalogDeps,
  OWNER_USER_ID,
  TEST_WORKSPACE_ID,
  VIEWER_USER_ID,
} from './helpers/catalog-test-deps.js';
import type { InMemoryCatalogPersistence } from './helpers/in-memory-catalog-persistence.js';

describe('Catalog Fact Sets Routes', () => {
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

  const validFactsPayload = {
    facts: [
      {
        factKey: 'battery_life_months',
        valueText: '24',
        sourceType: 'merchant_page' as const,
        sourceUrl: 'https://climate.example.com/specs',
        sourceExcerpt: 'Battery lasts up to 24 months with regular use.',
        confidence: 'confirmed' as const,
        claimUsage: 'allowed' as const,
      },
      {
        factKey: 'wireless_protocol',
        valueText: 'Zigbee 3.0',
        sourceType: 'document' as const,
        sourceUrl: null,
        sourceExcerpt: null,
        confidence: 'suggested' as const,
        claimUsage: 'context_only' as const,
      },
    ],
  };

  describe('GET /api/v1/workspaces/:workspaceId/products/:productId/fact-sets', () => {
    it('returns 401 when unauthenticated', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns empty list for newly created product', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/products/:productId/fact-sets', () => {
    it('rejects viewer role with 404 non-disclosing', async () => {
      const { deps, persistence, setActiveUser } = createTestCatalogDeps();
      seedProduct(persistence);
      setActiveUser(VIEWER_USER_ID);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456789' },
        payload: validFactsPayload,
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects empty facts array with 400', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456789' },
        payload: { facts: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects duplicate factKey in same set with 400 DUPLICATE_FACT_KEY', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456789' },
        payload: {
          facts: [
            {
              factKey: 'same_key',
              valueText: 'val1',
              sourceType: 'merchant_page',
              confidence: 'confirmed',
              claimUsage: 'allowed',
            },
            {
              factKey: 'same_key',
              valueText: 'val2',
              sourceType: 'merchant_page',
              confidence: 'confirmed',
              claimUsage: 'allowed',
            },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('DUPLICATE_FACT_KEY');
    });

    it('creates proposed fact set and increments revision number', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456781' },
        payload: validFactsPayload,
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['location']).toMatch(/\/fact-sets\/[0-9a-f-]{36}$/);
      const body = res.json();
      expect(body.factSet.revisionNumber).toBe(1);
      expect(body.factSet.status).toBe('proposed');
      expect(body.facts).toHaveLength(2);
      expect(body.facts[0].factKey).toBe('battery_life_months');
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId/products/:productId/fact-sets/:factSetId', () => {
    it('returns 404 for unknown fact set', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets/0192b012-3456-789a-8bcd-ef0123456799`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('FACT_SET_NOT_FOUND');
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/products/:productId/fact-sets/:factSetId/confirm', () => {
    it('confirms fact set, links to product currentFactSetId, and behaves idempotently', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      seedProduct(persistence);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const createRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin, 'idempotency-key': '0192b012-3456-789a-8bcd-ef0123456782' },
        payload: validFactsPayload,
      });
      const factSetId = createRes.json().factSet.id as ProductFactSetId;

      const confirmRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets/${factSetId}/confirm`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
      });
      expect(confirmRes.statusCode).toBe(200);
      expect(confirmRes.json().alreadyConfirmed).toBe(false);
      expect(confirmRes.json().factSet.status).toBe('confirmed');
      expect(confirmRes.json().factSet.confirmedByUserId).toBe(OWNER_USER_ID);
      expect(confirmRes.json().product.currentFactSetId).toBe(factSetId);

      const repeatRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${testProductId}/fact-sets/${factSetId}/confirm`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
        headers: { origin: validOrigin },
      });
      expect(repeatRes.statusCode).toBe(200);
      expect(repeatRes.json().alreadyConfirmed).toBe(true);
    });
  });
});
