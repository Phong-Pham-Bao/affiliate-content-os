import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import { TEST_WORKSPACE_ID } from './helpers/catalog-test-deps.js';
import {
  createTestWorkforceDeps,
  mockArtifactDetail,
  mockWorkOrder,
} from './helpers/workforce-test-deps.js';

describe('Workforce Routes', () => {
  const sessionCookie = 'A'.repeat(43);
  const productId = mockWorkOrder.productId;
  const workOrderId = mockWorkOrder.id;
  const artifactId = mockArtifactDetail.artifact.id;

  it('POST work-orders returns 400 when missing idempotency key', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'http://127.0.0.1:3000' },
      payload: { missionType: 'single_product_affiliate_launch', directiveText: 'Launch product' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET work-order returns 200 with full details', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workOrder.id).toBe(workOrderId);
  });

  it('GET work-orders returns 200 with list', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
  });

  it('GET artifacts returns 200 with artifact list', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}/artifacts`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].artifactType).toBe('product_campaign_plan');
  });

  it('GET artifact by id returns 200 with detail', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/${artifactId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.artifact.id).toBe(artifactId);
    expect(body.latestRevision.authorRoleKey).toBe('lead_product_strategist');
  });

  it('GET artifact by id returns 404 when not found', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/0192b012-3456-789a-8bcd-ef0123456999`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST retry returns 200 with retried item IDs', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}/retry`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'http://127.0.0.1:3000' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retriedItemIds).toHaveLength(1);
  });
});
