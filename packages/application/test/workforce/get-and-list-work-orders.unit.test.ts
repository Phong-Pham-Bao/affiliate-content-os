import { describe, expect, it, vi } from 'vitest';
import {
  parseContextPackageId,
  parseIsoTimestamp,
  parseProductId,
  parseUserId,
  parseWorkOrderId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { ValidationError, WorkspaceAccessDeniedError } from '../../src/errors.js';
import {
  decodeWorkOrderCursor,
  encodeWorkOrderCursor,
  getWorkOrder,
  listWorkOrders,
  type WorkOrderDetailDTO,
  type WorkOrderSummaryDTO,
} from '../../src/workforce/index.js';

describe('getWorkOrder and listWorkOrders Application Use Cases', () => {
  const wsId = '018f0000-0000-7000-8000-000000000001';
  const orderId = '018f0000-0000-7000-8000-000000000002';
  const actorId = '018f0000-0000-7000-8000-000000000003';
  const prodId = '018f0000-0000-7000-8000-000000000004';
  const contextPkgId = '018f0000-0000-7000-8000-000000000005';

  const ts = parseIsoTimestamp('2026-11-07T10:00:00.000Z');

  const mockSummary: WorkOrderSummaryDTO = {
    id: parseWorkOrderId(orderId),
    workspaceId: parseWorkspaceId(wsId),
    productId: parseProductId(prodId),
    contextPackageId: parseContextPackageId(contextPkgId),
    missionType: 'short_video_series',
    graphTemplate: 'creative_office_v1',
    graphVersion: 1,
    status: 'preparing',
    priority: 50,
    createdByUserId: parseUserId(actorId),
    failureCategory: null,
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
    version: 1,
  };

  const mockDetail: WorkOrderDetailDTO = {
    workOrder: mockSummary,
    contextPackage: {
      id: parseContextPackageId(contextPkgId),
      workspaceId: parseWorkspaceId(wsId),
      productId: parseProductId(prodId),
      factSetId: '018f0000-0000-7000-8000-000000000006',
      contextSchemaVersion: 1,
      contextHashHex: 'a'.repeat(64),
      analysisIds: [],
      createdByUserId: parseUserId(actorId),
      createdAt: ts,
    },
    workItems: [],
    assignments: [],
    dependencies: [],
  };

  function createMockDeps(role = 'viewer', status = 'active') {
    return {
      workforcePersistence: {
        kickoffWorkOrderAtomic: vi.fn(),
        getWorkOrderById: vi.fn().mockResolvedValue(mockDetail),
        listWorkOrders: vi.fn().mockResolvedValue([mockSummary]),
        findReadyWorkItems: vi.fn(),
      },
      workspaceAuthorization: {
        findMembership: vi.fn().mockResolvedValue({
          id: '018f0000-0000-7000-8000-000000000010',
          workspaceId: wsId,
          userId: actorId,
          role,
          status,
          invitedByUserId: null,
          joinedAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          version: 1,
        }),
      },
    };
  }

  describe('getWorkOrder', () => {
    it('allows viewer member to get work order detail', async () => {
      const deps = createMockDeps('viewer', 'active');
      const result = await getWorkOrder(
        { workspaceId: wsId, workOrderId: orderId, actorUserId: actorId },
        deps,
      );

      expect(result).toEqual(mockDetail);
      expect(deps.workforcePersistence.getWorkOrderById).toHaveBeenCalledWith(
        parseWorkspaceId(wsId),
        parseWorkOrderId(orderId),
      );
    });

    it('denies inactive member with WorkspaceAccessDeniedError', async () => {
      const deps = createMockDeps('editor', 'suspended');
      await expect(
        getWorkOrder({ workspaceId: wsId, workOrderId: orderId, actorUserId: actorId }, deps),
      ).rejects.toThrow(WorkspaceAccessDeniedError);
    });
  });

  describe('listWorkOrders', () => {
    it('returns work orders with cursor pagination metadata', async () => {
      const deps = createMockDeps('viewer', 'active');
      const result = await listWorkOrders(
        { workspaceId: wsId, actorUserId: actorId, limit: 10 },
        deps,
      );

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('computes nextCursor when more items exist than limit', async () => {
      const secondItem: WorkOrderSummaryDTO = {
        ...mockSummary,
        id: parseWorkOrderId('018f0000-0000-7000-8000-000000000099'),
        updatedAt: parseIsoTimestamp('2026-11-07T09:00:00.000Z'),
      };

      const deps = createMockDeps('viewer', 'active');
      deps.workforcePersistence.listWorkOrders = vi
        .fn()
        .mockResolvedValue([mockSummary, secondItem]);

      const result = await listWorkOrders(
        { workspaceId: wsId, actorUserId: actorId, limit: 1 },
        deps,
      );

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();

      const decoded = decodeWorkOrderCursor(result.nextCursor!);
      expect(decoded.id).toBe(mockSummary.id);
      expect(decoded.updatedAt).toBe(mockSummary.updatedAt);
    });

    it('rejects invalid limit', async () => {
      const deps = createMockDeps('viewer', 'active');
      await expect(
        listWorkOrders({ workspaceId: wsId, actorUserId: actorId, limit: 0 }, deps),
      ).rejects.toThrow(ValidationError);
      await expect(
        listWorkOrders({ workspaceId: wsId, actorUserId: actorId, limit: 101 }, deps),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Cursor encoding and decoding', () => {
    it('encodes and decodes cursor canonically', () => {
      const cursor = encodeWorkOrderCursor(mockSummary.updatedAt, mockSummary.id);
      const decoded = decodeWorkOrderCursor(cursor);

      expect(decoded.id).toBe(mockSummary.id);
      expect(decoded.updatedAt).toBe(mockSummary.updatedAt);
    });

    it('rejects malformed cursors', () => {
      expect(() => decodeWorkOrderCursor('not-valid-base64url')).toThrow(ValidationError);
      expect(() => decodeWorkOrderCursor('')).toThrow(ValidationError);
    });
  });
});
