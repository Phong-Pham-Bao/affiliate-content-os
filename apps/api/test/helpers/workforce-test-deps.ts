import { vi } from 'vitest';
import {
  parseIsoTimestamp,
  type ProductFactSetId,
  type ProductId,
  type ProductFactSetSnapshot,
  type ProductSnapshot,
  type UserId,
  type WorkspaceRole,
} from '@affiliate-content-os/domain';
import { OWNER_USER_ID, TEST_WORKSPACE_ID } from './catalog-test-deps.js';
import { createTestAnalysisDeps } from './analysis-test-deps.js';
import type { WorkforceRouteDependencies } from '../../src/workforce/types.js';

export const mockWorkOrder = {
  id: '0192b012-3456-789a-8bcd-ef0123456706',
  workspaceId: TEST_WORKSPACE_ID,
  productId: '0192b012-3456-789a-8bcd-ef0123456705',
  contextPackageId: '0192b012-3456-789a-8bcd-ef0123456708',
  missionType: 'single_product_affiliate_launch',
  graphTemplate: 'standard_v1',
  graphVersion: 1,
  status: 'in_progress',
  priority: 50,
  createdByUserId: '0192b012-3456-789a-8bcd-ef0123456709',
  createdAt: '2026-11-02T12:00:00.000Z',
  updatedAt: '2026-11-02T12:00:00.000Z',
  completedAt: null,
  failureCategory: null,
  version: 1,
};

export const mockArtifactDetail = {
  artifact: {
    id: '0192b012-3456-789a-8bcd-ef0123456707',
    workspaceId: TEST_WORKSPACE_ID,
    workOrderId: '0192b012-3456-789a-8bcd-ef0123456706',
    workItemId: 'wi-1',
    productId: '0192b012-3456-789a-8bcd-ef0123456705',
    artifactType: 'product_campaign_plan',
    currentLifecycleStatus: 'draft',
    currentRevisionId: 'rev-1',
    revisionCount: 1,
    createdAt: '2026-11-02T12:00:00.000Z',
    updatedAt: '2026-11-02T12:00:00.000Z',
    version: 1,
  },
  latestRevision: {
    id: 'rev-1',
    revisionNumber: 1,
    authorRoleKey: 'lead_product_strategist',
    authorAssignmentId: 'assign-1',
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
    createdAt: '2026-11-02T12:00:00.000Z',
    evidenceReferences: [],
  },
};

export function createTestWorkforceDeps(options?: {
  readonly defaultUserId?: UserId;
  readonly defaultRole?: WorkspaceRole;
}): WorkforceRouteDependencies {
  const { deps, catalogPersistence } = createTestAnalysisDeps(options);
  const activeUserId = options?.defaultUserId ?? OWNER_USER_ID;
  const factSetId = '0192b012-3456-789a-8bcd-ef0123456711';

  const productSnapshot: ProductSnapshot = {
    id: mockWorkOrder.productId as ProductId,
    workspaceId: TEST_WORKSPACE_ID,
    name: 'Test Product',
    merchantName: 'Test Merchant',
    canonicalUrl: 'https://example.com/product',
    canonicalUrlHash: new Uint8Array(32),
    category: 'electronics',
    description: 'Test description',
    audienceNotes: null,
    allowedClaimsNotes: null,
    prohibitedClaimsNotes: null,
    status: 'active',
    currentFactSetId: factSetId as ProductFactSetId,
    createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    version: 1,
  };
  catalogPersistence.products.set(
    `${TEST_WORKSPACE_ID}:${mockWorkOrder.productId}`,
    productSnapshot,
  );

  const factSetSnapshot: ProductFactSetSnapshot = {
    id: factSetId as ProductFactSetId,
    workspaceId: TEST_WORKSPACE_ID,
    productId: mockWorkOrder.productId as ProductId,
    revisionNumber: 1,
    status: 'confirmed',
    summary: null,
    createdByUserId: activeUserId,
    confirmedByUserId: activeUserId,
    confirmedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    createdAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-02T12:00:00.000Z'),
    version: 1,
  };
  catalogPersistence.factSets.set(
    `${TEST_WORKSPACE_ID}:${mockWorkOrder.productId}:${factSetId}`,
    factSetSnapshot,
  );

  return {
    auth: deps.auth,
    workspaceAuthorization: deps.workspaceAuthorization,
    catalogPersistence: deps.catalogPersistence,
    analysisPersistence: deps.analysisPersistence,
    workforcePersistence: {
      kickoffWorkOrderAtomic: vi
        .fn()
        .mockResolvedValue({ workOrder: mockWorkOrder, cached: false }),
      getWorkOrderById: vi.fn().mockImplementation((_ws, id) => {
        if (id === mockWorkOrder.id) {
          return Promise.resolve({
            workOrder: mockWorkOrder,
            contextPackage: { id: 'pkg-1', workspaceId: TEST_WORKSPACE_ID, analysisIds: [] },
            workItems: [],
            assignments: [],
            dependencies: [],
          });
        }
        return Promise.resolve(null);
      }),
      listWorkOrders: vi.fn().mockResolvedValue([mockWorkOrder]),
      findReadyWorkItems: vi.fn().mockResolvedValue([]),
      listWorkOrderArtifacts: vi.fn().mockResolvedValue([mockArtifactDetail.artifact]),
      getArtifactById: vi.fn().mockImplementation((_ws, id) => {
        if (id === mockArtifactDetail.artifact.id) {
          return Promise.resolve(mockArtifactDetail);
        }
        return Promise.resolve(null);
      }),
      listWorkOrderActivities: vi.fn().mockResolvedValue([
        {
          id: 'act-1',
          workspaceId: TEST_WORKSPACE_ID,
          workOrderId: mockWorkOrder.id,
          actorUserId: 'user-1',
          actorType: 'user',
          action: 'work_order.kicked_off',
          resourceType: 'work_order',
          resourceId: mockWorkOrder.id,
          changes: {},
          result: 'success',
          createdAt: '2026-11-02T12:00:00.000Z',
        },
      ]),
      retryWorkOrderPlanningAtomic: vi.fn().mockResolvedValue({
        workOrder: { ...mockWorkOrder, status: 'in_progress' },
        retriedItemIds: ['wi-1'],
        cached: false,
      }),
    },
  };
}
