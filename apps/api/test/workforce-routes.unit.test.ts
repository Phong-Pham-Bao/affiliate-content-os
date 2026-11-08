import { describe, expect, it, vi } from 'vitest';
import {
  IdempotencyConflictError,
  IdempotencyKeyReusedError,
} from '@affiliate-content-os/application';
import { createApp } from '../src/app.js';
import { COOKIE_SESSION } from '../src/auth/constants.js';
import { FOREIGN_WORKSPACE_ID, TEST_WORKSPACE_ID } from './helpers/catalog-test-deps.js';
import {
  createTestWorkforceDeps,
  mockArtifactDetail,
  mockWorkOrder,
} from './helpers/workforce-test-deps.js';

describe('Workforce Routes', () => {
  const sessionCookie = 'A'.repeat(43);
  const validOrigin = 'http://127.0.0.1:3000';
  const idempotencyKey = '0192b012-3456-789a-8bcd-ef0123456789';
  const productId = mockWorkOrder.productId;
  const workOrderId = mockWorkOrder.id;
  const artifactId = mockArtifactDetail.artifact.id;
  const validKickoffPayload = {
    missionType: 'single_product_affiliate_launch',
    directiveText: 'Launch product campaign',
  };

  it('denies unauthenticated requests on read and mutation routes', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const postRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validKickoffPayload,
    });
    expect(postRes.statusCode).toBe(401);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}`,
    });
    expect(getRes.statusCode).toBe(401);

    const retryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}/retry`,
      headers: { origin: validOrigin },
    });
    expect(retryRes.statusCode).toBe(401);
  });

  it('allows viewer role to read work-orders but denies kickoff and retry with non-disclosing 404', async () => {
    const deps = createTestWorkforceDeps({ defaultRole: 'viewer' });
    const app = createApp({ auth: deps.auth, workforce: deps });

    const readOrderRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(readOrderRes.statusCode).toBe(200);

    const listOrdersRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(listOrdersRes.statusCode).toBe(200);

    const kickoffRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validKickoffPayload,
    });
    expect(kickoffRes.statusCode).toBe(404);
    expect(kickoffRes.json().code).toBe('WORKSPACE_NOT_FOUND');

    const retryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}/retry`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin },
    });
    expect(retryRes.statusCode).toBe(404);
    expect(retryRes.json().code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('denies invalid mutation origin header on POST kickoff and retry', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const kickoffRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'https://malicious.example.com', 'idempotency-key': idempotencyKey },
      payload: validKickoffPayload,
    });
    expect(kickoffRes.statusCode).toBe(403);

    const retryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}/retry`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: 'https://malicious.example.com' },
    });
    expect(retryRes.statusCode).toBe(403);
  });

  it('sets no-store cache headers on reads and mutations', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['cache-control']).toBe('no-store');
    expect(getRes.headers['pragma']).toBe('no-cache');

    const postRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validKickoffPayload,
    });
    expect(postRes.statusCode).toBe(201);
    expect(postRes.headers['cache-control']).toBe('no-store');
    expect(postRes.headers['pragma']).toBe('no-cache');
  });

  it('validates params, body, and idempotency header schema', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const missingKeyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin },
      payload: validKickoffPayload,
    });
    expect(missingKeyRes.statusCode).toBe(400);

    const badParamRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/not-a-uuid/work-orders/${workOrderId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(badParamRes.statusCode).toBe(400);

    const badBodyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: { missionType: 'invalid_mission', extraUnknownProperty: true },
    });
    expect(badBodyRes.statusCode).toBe(400);
  });

  it('handles tenant mismatch and missing resources with safe non-disclosing 404', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });

    const foreignRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${FOREIGN_WORKSPACE_ID}/work-orders/${workOrderId}`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(foreignRes.statusCode).toBe(404);
    expect(foreignRes.json().code).toBe('WORKSPACE_NOT_FOUND');

    const missingOrderRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/0192b012-3456-789a-8bcd-ef0123456999`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(missingOrderRes.statusCode).toBe(404);
    expect(missingOrderRes.json().code).toBe('WORK_ORDER_NOT_FOUND');

    const missingArtifactRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/artifacts/0192b012-3456-789a-8bcd-ef0123456999`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
    });
    expect(missingArtifactRes.statusCode).toBe(404);
    expect(missingArtifactRes.json().code).toBe('ARTIFACT_NOT_FOUND');
  });

  it('handles idempotency replay and conflicts correctly', async () => {
    const deps = createTestWorkforceDeps();
    (deps.workforcePersistence.kickoffWorkOrderAtomic as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ workOrder: mockWorkOrder, cached: false })
      .mockResolvedValueOnce({ workOrder: mockWorkOrder, cached: true });

    const app = createApp({ auth: deps.auth, workforce: deps });

    const initialRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validKickoffPayload,
    });
    expect(initialRes.statusCode).toBe(201);
    expect(initialRes.json().replayed).toBe(false);

    const replayRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validKickoffPayload,
    });
    expect(replayRes.statusCode).toBe(201);
    expect(replayRes.json().replayed).toBe(true);

    (
      deps.workforcePersistence.kickoffWorkOrderAtomic as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new IdempotencyConflictError());

    const conflictRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validKickoffPayload,
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().code).toBe('IDEMPOTENCY_CONFLICT');

    (
      deps.workforcePersistence.kickoffWorkOrderAtomic as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new IdempotencyKeyReusedError());

    const reusedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/products/${productId}/work-orders`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin, 'idempotency-key': idempotencyKey },
      payload: validKickoffPayload,
    });
    expect(reusedRes.statusCode).toBe(409);
    expect(reusedRes.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
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

  it('POST retry returns 200 with retried item IDs', async () => {
    const deps = createTestWorkforceDeps();
    const app = createApp({ auth: deps.auth, workforce: deps });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${TEST_WORKSPACE_ID}/work-orders/${workOrderId}/retry`,
      cookies: { [COOKIE_SESSION]: sessionCookie },
      headers: { origin: validOrigin },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retriedItemIds).toHaveLength(1);
  });
});
