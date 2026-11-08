import { describe, expect, it, vi } from 'vitest';
import { parseUserId, parseWorkspaceId } from '@affiliate-content-os/domain';
import type { WorkspaceAuthorizationPort } from '../../src/index.js';
import {
  getArtifactById,
  listWorkOrderActivities,
  listWorkOrderArtifacts,
  retryWorkOrderPlanning,
  type WorkforceAnalysisQueryPort,
  type WorkforceCatalogQueryPort,
  type WorkforcePersistencePort,
} from '../../src/workforce/index.js';

describe('Checkpoint B Workforce Use Cases', () => {
  const wsId = '019318b2-5f33-722e-a5df-036f007b89f7';
  const userId = '019318b2-5f33-722e-a5df-036f007b89f8';
  const woId = '019318b2-5f33-722e-a5df-036f007b89f9';
  const artifactId = '019318b2-5f33-722e-a5df-036f007b89fa';

  const mockAuth: WorkspaceAuthorizationPort = {
    findMembership: vi.fn().mockResolvedValue({
      id: '019318b2-5f33-722e-a5df-036f007b89f0',
      workspaceId: wsId,
      userId,
      role: 'editor',
      status: 'active',
      invitedByUserId: null,
      joinedAt: '2026-03-01T00:00:00.000Z',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      version: 1,
    }),
  };

  it('lists work order artifacts after authorizing catalog.read', async () => {
    const mockPersistence = {
      listWorkOrderArtifacts: vi.fn().mockResolvedValue([
        {
          id: artifactId,
          workspaceId: wsId,
          workOrderId: woId,
          workItemId: '019318b2-5f33-722e-a5df-036f007b89fb',
          productId: '019318b2-5f33-722e-a5df-036f007b89fc',
          artifactType: 'product_campaign_plan',
          currentLifecycleStatus: 'draft',
          currentRevisionId: '019318b2-5f33-722e-a5df-036f007b89fd',
          revisionCount: 1,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          version: 1,
        },
      ]),
    };

    const result = await listWorkOrderArtifacts(
      { workspaceId: wsId, workOrderId: woId, actorUserId: userId },
      {
        workforcePersistence: mockPersistence as unknown as WorkforcePersistencePort,
        workspaceAuthorization: mockAuth as unknown as WorkspaceAuthorizationPort,
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.artifactType).toBe('product_campaign_plan');
    expect(mockAuth.findMembership).toHaveBeenCalledWith({
      workspaceId: parseWorkspaceId(wsId),
      userId: parseUserId(userId),
    });
  });

  it('gets artifact by id after authorizing catalog.read', async () => {
    const mockPersistence = {
      getArtifactById: vi.fn().mockResolvedValue({
        artifact: {
          id: artifactId,
          workspaceId: wsId,
          workOrderId: woId,
          workItemId: '019318b2-5f33-722e-a5df-036f007b89fb',
          productId: '019318b2-5f33-722e-a5df-036f007b89fc',
          artifactType: 'product_campaign_plan',
          currentLifecycleStatus: 'draft',
          currentRevisionId: '019318b2-5f33-722e-a5df-036f007b89fd',
          revisionCount: 1,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          version: 1,
        },
        latestRevision: {
          id: '019318b2-5f33-722e-a5df-036f007b89fd',
          revisionNumber: 1,
          authorRoleKey: 'lead_product_strategist',
          authorAssignmentId: '019318b2-5f33-722e-a5df-036f007b89fe',
          contentJson: { strategicAngle: 'Premium ergonomics' },
          canonicalContentHashHex: 'abcd',
          schemaVersion: 1,
          promptTemplate: 'product_strategy_v1',
          promptVersion: '1.0.0',
          provider: 'google',
          model: 'gemini-3.8-flash',
          tokensInput: 100,
          tokensOutput: 200,
          costMicrounits: 1500,
          latencyMs: 1200,
          supersededByRevisionId: null,
          createdAt: '2026-03-01T00:00:00.000Z',
          evidenceReferences: [],
        },
      }),
    };

    const result = await getArtifactById(
      { workspaceId: wsId, artifactId, actorUserId: userId },
      {
        workforcePersistence: mockPersistence as unknown as WorkforcePersistencePort,
        workspaceAuthorization: mockAuth as unknown as WorkspaceAuthorizationPort,
      },
    );

    expect(result).not.toBeNull();
    expect(result?.latestRevision?.authorRoleKey).toBe('lead_product_strategist');
  });

  it('lists work order activities after authorizing catalog.read', async () => {
    const mockPersistence = {
      listWorkOrderActivities: vi.fn().mockResolvedValue([
        {
          id: '019318b2-5f33-722e-a5df-036f007b89ff',
          workspaceId: wsId,
          workOrderId: woId,
          actorUserId: userId,
          actorType: 'user',
          action: 'work_order.kicked_off',
          resourceType: 'work_order',
          resourceId: woId,
          changes: {},
          result: 'success',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
      ]),
    };

    const result = await listWorkOrderActivities(
      { workspaceId: wsId, workOrderId: woId, actorUserId: userId },
      {
        workforcePersistence: mockPersistence as unknown as WorkforcePersistencePort,
        workspaceAuthorization: mockAuth as unknown as WorkspaceAuthorizationPort,
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe('work_order.kicked_off');
  });

  it('retries work order planning after authorizing catalog.manage', async () => {
    const mockPersistence = {
      retryWorkOrderPlanningAtomic: vi.fn().mockResolvedValue({
        workOrder: {
          id: woId,
          workspaceId: wsId,
          productId: '019318b2-5f33-722e-a5df-036f007b89fc',
          status: 'in_progress',
        },
        retriedItemIds: ['019318b2-5f33-722e-a5df-036f007b89fb'],
        cached: false,
      }),
    };

    const result = await retryWorkOrderPlanning(
      { workspaceId: wsId, workOrderId: woId, actorUserId: userId },
      {
        workforcePersistence: mockPersistence as unknown as WorkforcePersistencePort,
        workspaceAuthorization: mockAuth as unknown as WorkspaceAuthorizationPort,
        catalogQuery: {} as unknown as WorkforceCatalogQueryPort,
        analysisQuery: {} as unknown as WorkforceAnalysisQueryPort,
      },
    );

    expect(result.retriedItemIds).toHaveLength(1);
    expect(result.workOrder.status).toBe('in_progress');
    expect(mockAuth.findMembership).toHaveBeenCalledWith({
      workspaceId: parseWorkspaceId(wsId),
      userId: parseUserId(userId),
    });
  });
});
