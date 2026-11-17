import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkOrderDetailDTO } from '../src/types/workforce.js';
import { pollWorkOrderUntilTerminal } from '../src/lib/workforce-operation-polling.js';
import * as client from '../src/lib/workforce-api-client.js';

function makeDetail(
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled',
  planningCompleted = false,
): WorkOrderDetailDTO {
  return {
    workOrder: {
      id: 'wo-1',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      contextPackageId: 'cp-1',
      missionType: 'single_product_affiliate_launch',
      graphTemplate: 'single_product_affiliate_launch',
      graphVersion: 1,
      status,
      priority: 1,
      createdByUserId: 'u-1',
      failureCategory: null,
      completedAt: status === 'completed' ? '2026-11-18T00:05:00Z' : null,
      createdAt: '2026-11-18T00:00:00Z',
      updatedAt: '2026-11-18T00:00:00Z',
      version: 1,
    },
    contextPackage: {
      id: 'cp-1',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      factSetId: 'fs-1',
      contextSchemaVersion: 1,
      contextHashHex: 'hash',
      analysisIds: [],
      createdByUserId: 'u-1',
      createdAt: '2026-11-18T00:00:00Z',
    },
    workItems: [
      {
        id: 'wi-1',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-1',
        roleKey: 'product_strategist',
        taskKey: 'product_strategy',
        expectedArtifactType: 'product_campaign_plan',
        status: planningCompleted ? 'completed' : 'in_progress',
        blockedReasonCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
      {
        id: 'wi-2',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-2',
        roleKey: 'audience_strategist',
        taskKey: 'audience_strategy',
        expectedArtifactType: 'audience_insight_board',
        status: planningCompleted ? 'completed' : 'in_progress',
        blockedReasonCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
      {
        id: 'wi-3',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-3',
        roleKey: 'creative_director',
        taskKey: 'creative_direction',
        expectedArtifactType: 'video_series_plan',
        status: planningCompleted ? 'completed' : 'in_progress',
        blockedReasonCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
      {
        id: 'wi-4',
        workOrderId: 'wo-1',
        roleDefinitionId: 'rd-4',
        roleKey: 'scriptwriter',
        taskKey: 'script_package',
        expectedArtifactType: 'script_package',
        status: planningCompleted ? 'in_progress' : 'waiting_dependency',
        blockedReasonCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z',
        version: 1,
      },
    ],
    assignments: [],
    dependencies: [],
  };
}

describe('full-lifecycle workforce polling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT stop merely because planning items finished, but continues until work order is terminal', async () => {
    const snapshots: WorkOrderDetailDTO[] = [
      makeDetail('in_progress', false), // attempt 1: planning running
      makeDetail('in_progress', true), // attempt 2: planning finished, script running
      makeDetail('completed', true), // attempt 3: entire order completed
    ];

    let callCount = 0;
    vi.spyOn(client, 'fetchWorkOrderApi').mockImplementation(async () => {
      const idx = Math.min(callCount, snapshots.length - 1);
      callCount++;
      return snapshots[idx]!;
    });

    const updates: WorkOrderDetailDTO[] = [];
    const ctrl = new AbortController();

    const result = await pollWorkOrderUntilTerminal(
      'ws-1',
      'wo-1',
      ctrl.signal,
      (detail) => updates.push(detail),
      { initialIntervalMs: 5, maxIntervalMs: 10, backoffMultiplier: 1.1, maxAttempts: 10 },
    );

    expect(callCount).toBe(3);
    expect(result.workOrder.status).toBe('completed');
    expect(updates).toHaveLength(3);
  });

  it('aborts immediately and safely when signal is aborted', async () => {
    vi.spyOn(client, 'fetchWorkOrderApi').mockImplementation(async () => {
      return makeDetail('in_progress', false);
    });

    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      pollWorkOrderUntilTerminal('ws-1', 'wo-1', ctrl.signal, () => {}, {
        initialIntervalMs: 10,
      }),
    ).rejects.toThrow('Polling aborted');
  });

  it('returns last authoritative detail without error when maxAttempts deadline is reached', async () => {
    vi.spyOn(client, 'fetchWorkOrderApi').mockImplementation(async () => {
      return makeDetail('in_progress', true);
    });

    const ctrl = new AbortController();
    const result = await pollWorkOrderUntilTerminal('ws-1', 'wo-1', ctrl.signal, () => {}, {
      initialIntervalMs: 5,
      maxIntervalMs: 5,
      maxAttempts: 2,
    });

    expect(result.workOrder.status).toBe('in_progress');
  });
});
