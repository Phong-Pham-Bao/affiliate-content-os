import { describe, expect, it } from 'vitest';
import { parseIsoTimestamp, type ProductId } from '@affiliate-content-os/domain';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import {
  createTestCatalogDeps,
  FOREIGN_WORKSPACE_ID,
  TEST_WORKSPACE_ID,
  VIEWER_USER_ID,
} from './helpers/catalog-test-deps.js';

describe('Catalog Products Read Routes', () => {
  const validSessionCookie = 'A'.repeat(43);

  describe('GET /api/v1/workspaces/:workspaceId/products', () => {
    it('returns 401 AUTHENTICATION_REQUIRED when session cookie is missing', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('returns 404 WORKSPACE_NOT_FOUND when user has no access to workspace', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('allows viewer role and returns empty list initially', async () => {
      const { deps, setActiveUser } = createTestCatalogDeps();
      setActiveUser(VIEWER_USER_ID);
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toEqual([]);
      expect(body.page).toEqual({ nextCursor: null, hasMore: false });
    });

    it('returns 400 on invalid limit or malformed status filter', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const resBadLimit = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products?limit=999`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });
      expect(resBadLimit.statusCode).toBe(400);

      const resBadStatus = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products?status=invalid_status`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });
      expect(resBadStatus.statusCode).toBe(400);
    });

    it('filters products by status and applies limit', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const p1 = {
        id: '0192b012-3456-789a-8bcd-ef0123456751' as ProductId,
        workspaceId: TEST_WORKSPACE_ID,
        name: 'Draft Product',
        merchantName: 'Store 1',
        canonicalUrl: 'https://example.com/p1',
        canonicalUrlHash: new Uint8Array(32).fill(1),
        category: 'electronics',
        description: 'Test draft product',
        audienceNotes: null,
        allowedClaimsNotes: null,
        prohibitedClaimsNotes: null,
        status: 'draft' as const,
        currentFactSetId: null,
        createdAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
        version: 1,
      };
      const p2 = {
        ...p1,
        id: '0192b012-3456-789a-8bcd-ef0123456752' as ProductId,
        name: 'Active Product',
        canonicalUrl: 'https://example.com/p2',
        canonicalUrlHash: new Uint8Array(32).fill(2),
        status: 'active' as const,
        createdAt: parseIsoTimestamp('2026-11-06T11:00:00.000Z'),
      };
      persistence.products.set(`${TEST_WORKSPACE_ID}:${p1.id}`, p1);
      persistence.products.set(`${TEST_WORKSPACE_ID}:${p2.id}`, p2);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products?status=active`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(p2.id);
      expect(body.items[0].status).toBe('active');
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId/products/:productId', () => {
    it('returns 404 when product does not exist', async () => {
      const { deps } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/0192b012-3456-789a-8bcd-ef0123456799`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('PRODUCT_NOT_FOUND');
    });

    it('returns 200 with product details and ETag', async () => {
      const { deps, persistence } = createTestCatalogDeps();
      const app = createApp({ auth: deps.auth, catalog: deps });

      const p = {
        id: '0192b012-3456-789a-8bcd-ef0123456755' as ProductId,
        workspaceId: TEST_WORKSPACE_ID,
        name: 'Single Product',
        merchantName: 'Store',
        canonicalUrl: 'https://example.com/p55',
        canonicalUrlHash: new Uint8Array(32).fill(5),
        category: 'home',
        description: 'Single product description',
        audienceNotes: 'Audience note',
        allowedClaimsNotes: 'Allowed claim',
        prohibitedClaimsNotes: 'Prohibited claim',
        status: 'draft' as const,
        currentFactSetId: null,
        createdAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
        updatedAt: parseIsoTimestamp('2026-11-06T10:00:00.000Z'),
        version: 3,
      };
      persistence.products.set(`${TEST_WORKSPACE_ID}:${p.id}`, p);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${p.id}`,
        cookies: { [COOKIE_SESSION]: validSessionCookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['etag']).toBe('"3"');
      const body = res.json();
      expect(body.id).toBe(p.id);
      expect(body.version).toBe(3);
      expect(body.audienceNotes).toBe('Audience note');
    });
  });
});
