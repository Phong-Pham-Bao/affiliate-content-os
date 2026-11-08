import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchArtifactDetailApi,
  fetchWorkOrderActivitiesApi,
  fetchWorkOrderArtifactsApi,
  fetchWorkOrderApi,
  fetchWorkOrdersApi,
  kickoffWorkOrderApi,
  retryWorkOrderPlanningApi,
} from '../src/lib/workforce-api-client.js';

describe('Workforce API Client', () => {
  const wsId = '018f6c5b-21a4-789a-8def-000000000001';
  const prodId = '018f6c5b-21a4-789a-8def-000000000002';
  const woId = '018f6c5b-21a4-789a-8def-000000000003';
  const artId = '018f6c5b-21a4-789a-8def-000000000004';

  const mockWorkOrder = {
    id: woId,
    workspaceId: wsId,
    productId: prodId,
    contextPackageId: '018f6c5b-21a4-789a-8def-000000000005',
    missionType: 'single_product_affiliate_launch',
    graphTemplate: 'creative_office_v1',
    graphVersion: 1,
    status: 'in_progress',
    priority: 50,
    createdByUserId: '018f6c5b-21a4-789a-8def-000000000006',
    failureCategory: null,
    completedAt: null,
    createdAt: '2026-11-08T12:00:00.000Z',
    updatedAt: '2026-11-08T12:00:00.000Z',
    version: 1,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('kickoffWorkOrderApi sends POST with Idempotency-Key and payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ workOrder: mockWorkOrder, cached: false }),
    } as unknown as Response);

    const result = await kickoffWorkOrderApi(
      wsId,
      prodId,
      {
        missionType: 'single_product_affiliate_launch',
        directiveText: 'Launch campaign',
        priority: 50,
      },
      'idemp-key-1',
    );

    expect(result.workOrder.id).toBe(woId);
    expect(result.cached).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${wsId}/products/${prodId}/work-orders`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': 'idemp-key-1',
        }),
      }),
    );
  });

  it('fetchWorkOrderApi calls GET and returns work order details', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        workOrder: mockWorkOrder,
        contextPackage: {
          id: '018f6c5b-21a4-789a-8def-000000000005',
          workspaceId: wsId,
          productId: prodId,
          factSetId: 'fact-1',
          contextSchemaVersion: 1,
          contextHashHex: 'hash',
          analysisIds: [],
          createdByUserId: 'user-1',
          createdAt: '2026-11-08T12:00:00.000Z',
        },
        workItems: [],
        assignments: [],
        dependencies: [],
      }),
    } as unknown as Response);

    const result = await fetchWorkOrderApi(wsId, woId);
    expect(result.workOrder.id).toBe(woId);
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${wsId}/work-orders/${woId}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fetchWorkOrdersApi calls GET with query parameters', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ items: [mockWorkOrder], nextCursor: null }),
    } as unknown as Response);

    const result = await fetchWorkOrdersApi(wsId, { limit: 10 });
    expect(result.items).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/workspaces/${wsId}/work-orders?limit=10`,
      expect.anything(),
    );
  });

  it('fetchWorkOrderArtifactsApi and fetchArtifactDetailApi work properly', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        items: [
          {
            id: artId,
            workspaceId: wsId,
            productId: prodId,
            workOrderId: woId,
            workItemId: 'wi-1',
            assignmentId: 'as-1',
            authorRoleKey: 'product_strategist',
            artifactType: 'product_campaign_plan',
            lifecycleStatus: 'review_required',
            currentRevisionNumber: 1,
            createdAt: '2026-11-08T12:00:00.000Z',
            updatedAt: '2026-11-08T12:00:00.000Z',
            version: 1,
          },
        ],
      }),
    } as unknown as Response);

    const arts = await fetchWorkOrderArtifactsApi(wsId, woId);
    expect(arts).toHaveLength(1);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        artifact: arts[0],
        latestRevision: {
          id: 'rev-1',
          workspaceId: wsId,
          artifactId: artId,
          revisionNumber: 1,
          contentJson: { summary: 'Plan' },
          contentHashHex: 'hash',
          schemaVersion: 1,
          promptTemplate: 'tmpl',
          promptVersion: '1.0',
          provider: 'google',
          model: 'gemini-3.8-flash',
          tokenInput: 100,
          tokenOutput: 50,
          costMicrounits: 1000,
          costCurrency: 'USD',
          latencyMs: 500,
          authorRoleKey: 'product_strategist',
          createdAt: '2026-11-08T12:00:00.000Z',
        },
        evidenceReferences: [],
      }),
    } as unknown as Response);

    const detail = await fetchArtifactDetailApi(wsId, artId);
    expect(detail.artifact.id).toBe(artId);
  });

  it('fetchWorkOrderActivitiesApi calls GET and returns activities', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        items: [
          {
            id: 'act-1',
            action: 'work_order.kickoff',
            resourceType: 'work_order',
            resourceId: woId,
            result: 'success',
            occurredAt: '2026-11-08T12:00:00.000Z',
            changesJson: {},
          },
        ],
      }),
    } as unknown as Response);

    const activities = await fetchWorkOrderActivitiesApi(wsId, woId);
    expect(activities).toHaveLength(1);
    expect(activities[0]?.action).toBe('work_order.kickoff');
  });

  it('retryWorkOrderPlanningApi sends POST and returns retry result', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        workOrder: mockWorkOrder,
        retriedItemIds: ['wi-1'],
        cached: false,
      }),
    } as unknown as Response);

    const result = await retryWorkOrderPlanningApi(wsId, woId);
    expect(result.retriedItemIds).toHaveLength(1);
  });
});
