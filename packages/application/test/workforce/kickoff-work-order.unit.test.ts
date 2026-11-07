import { describe, expect, it, vi } from 'vitest';
import {
  parseAnalysisId,
  parseContextPackageId,
  parseIsoTimestamp,
  parseMembershipId,
  parseProductId,
  parseUserId,
  parseWorkOrderId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { ProductArchivedError, ProductNotFoundError } from '../../src/catalog/errors.js';
import { ValidationError, WorkspaceAccessDeniedError } from '../../src/errors.js';
import {
  kickoffWorkOrder,
  WorkforceAnalysisNotAcceptedError,
  WorkforceFactSetNotConfirmedError,
  type WorkforceDependencies,
} from '../../src/workforce/index.js';

describe('kickoffWorkOrder Application Use Case', () => {
  const wsId = '018f0000-0000-7000-8000-000000000001';
  const prodId = '018f0000-0000-7000-8000-000000000002';
  const factSetId = '018f0000-0000-7000-8000-000000000003';
  const actorId = '018f0000-0000-7000-8000-000000000004';
  const analysisId = '018f0000-0000-7000-8000-000000000005';
  const orderId = '018f0000-0000-7000-8000-000000000099';
  const contextPkgId = '018f0000-0000-7000-8000-000000000098';

  const ts = parseIsoTimestamp('2026-11-07T10:00:00.000Z');

  function createMockDeps(overrides: Partial<WorkforceDependencies> = {}): WorkforceDependencies {
    return {
      workforcePersistence: {
        kickoffWorkOrderAtomic: vi.fn().mockResolvedValue({
          workOrder: {
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
          },
          cached: false,
        }),
        getWorkOrderById: vi.fn(),
        listWorkOrders: vi.fn(),
        findReadyWorkItems: vi.fn(),
      },
      workspaceAuthorization: {
        findMembership: vi.fn().mockResolvedValue({
          id: '018f0000-0000-7000-8000-000000000010',
          workspaceId: wsId,
          userId: actorId,
          role: 'editor',
          status: 'active',
          invitedByUserId: null,
          joinedAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          version: 1,
        }),
      },
      catalogQuery: {
        findProductById: vi.fn().mockResolvedValue({
          id: parseProductId(prodId),
          workspaceId: parseWorkspaceId(wsId),
          status: 'draft',
          currentFactSetId: factSetId,
          version: 1,
        }),
        findFactSetById: vi.fn().mockResolvedValue({
          id: factSetId,
          productId: parseProductId(prodId),
          workspaceId: parseWorkspaceId(wsId),
          status: 'confirmed',
          version: 1,
        }),
      },
      analysisQuery: {
        getAnalysisById: vi.fn().mockResolvedValue({
          id: parseAnalysisId(analysisId),
          workspaceId: parseWorkspaceId(wsId),
          productId: parseProductId(prodId),
          status: 'accepted',
          version: 1,
        }),
      },
      idGenerator: {
        generateId: (() => {
          let count = 100;
          return () => `018f0000-0000-7000-8000-${String(++count).padStart(12, '0')}`;
        })(),
        generateWorkspaceId: () => parseWorkspaceId('018f0000-0000-7000-8000-000000000001'),
        generateMembershipId: () => parseMembershipId('018f0000-0000-7000-8000-000000000010'),
        generateUserId: () => parseUserId('018f0000-0000-7000-8000-000000000004'),
      },
      ...overrides,
    };
  }

  const validCommand = {
    workspaceId: wsId,
    productId: prodId,
    missionType: 'short_video_series',
    directiveText: 'Lập kế hoạch nội dung và đạo diễn một series 5 video ngắn.',
    acceptedAnalysisIds: [analysisId],
    priority: 50,
    idempotencyKey: 'idemp-key-12345',
    actorUserId: actorId,
  };

  it('successfully kicks off a creative work order and returns the summary', async () => {
    const deps = createMockDeps();
    const result = await kickoffWorkOrder(validCommand, deps);

    expect(result.replayed).toBe(false);
    expect(result.workOrder.id).toBe(orderId);
    expect(deps.workforcePersistence.kickoffWorkOrderAtomic).toHaveBeenCalledOnce();

    const mockFn = deps.workforcePersistence.kickoffWorkOrderAtomic as ReturnType<typeof vi.fn>;
    expect(mockFn.mock.calls.length).toBeGreaterThan(0);
    const callArg = mockFn.mock.calls[0]![0];
    expect(callArg.workOrder.missionType).toBe('short_video_series');
    expect(callArg.workOrder.graphTemplate).toBe('creative_office_v1');
    expect(callArg.workItems).toHaveLength(5);
    expect(callArg.assignments).toHaveLength(6);
    expect(callArg.dependencies).toHaveLength(4);
    expect(callArg.auditEvent.action).toBe('creative.work_order.created');
    expect(callArg.auditEvent.resourceType).toBe('work_order');
    expect(callArg.auditEvent.changesJson).not.toHaveProperty('directiveText');
  });

  it('returns replayed: true when idempotency result is cached', async () => {
    const deps = createMockDeps({
      workforcePersistence: {
        kickoffWorkOrderAtomic: vi.fn().mockResolvedValue({
          workOrder: {
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
            createdAt: '2026-11-07T10:00:00.000Z',
            updatedAt: '2026-11-07T10:00:00.000Z',
            version: 1,
          },
          cached: true,
        }),
        getWorkOrderById: vi.fn(),
        listWorkOrders: vi.fn(),
        findReadyWorkItems: vi.fn(),
      },
    });

    const result = await kickoffWorkOrder(validCommand, deps);
    expect(result.replayed).toBe(true);
  });

  it('denies viewer role with WorkspaceAccessDeniedError', async () => {
    const deps = createMockDeps({
      workspaceAuthorization: {
        findMembership: vi.fn().mockResolvedValue({
          id: '018f0000-0000-7000-8000-000000000010',
          workspaceId: wsId,
          userId: actorId,
          role: 'viewer',
          status: 'active',
          invitedByUserId: null,
          joinedAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          version: 1,
        }),
      },
    });

    await expect(kickoffWorkOrder(validCommand, deps)).rejects.toThrow(WorkspaceAccessDeniedError);
  });

  it('rejects invalid mission type', async () => {
    const deps = createMockDeps();
    await expect(
      kickoffWorkOrder({ ...validCommand, missionType: 'unsupported' }, deps),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects invalid directive text (untrimmed)', async () => {
    const deps = createMockDeps();
    await expect(
      kickoffWorkOrder({ ...validCommand, directiveText: '  directive with spaces  ' }, deps),
    ).rejects.toThrow(/whitespace/);
  });

  it('rejects invalid idempotency key', async () => {
    const deps = createMockDeps();
    await expect(
      kickoffWorkOrder({ ...validCommand, idempotencyKey: 'bad key with spaces' }, deps),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects product not found', async () => {
    const deps = createMockDeps({
      catalogQuery: {
        findProductById: vi.fn().mockResolvedValue(null),
        findFactSetById: vi.fn(),
      },
    });

    await expect(kickoffWorkOrder(validCommand, deps)).rejects.toThrow(ProductNotFoundError);
  });

  it('rejects archived product', async () => {
    const deps = createMockDeps({
      catalogQuery: {
        findProductById: vi.fn().mockResolvedValue({
          id: parseProductId(prodId),
          workspaceId: parseWorkspaceId(wsId),
          status: 'archived',
          currentFactSetId: factSetId,
          version: 1,
        }),
        findFactSetById: vi.fn(),
      },
    });

    await expect(kickoffWorkOrder(validCommand, deps)).rejects.toThrow(ProductArchivedError);
  });

  it('rejects unconfirmed fact set', async () => {
    const deps = createMockDeps({
      catalogQuery: {
        findProductById: vi.fn().mockResolvedValue({
          id: parseProductId(prodId),
          workspaceId: parseWorkspaceId(wsId),
          status: 'active',
          currentFactSetId: factSetId,
          version: 1,
        }),
        findFactSetById: vi.fn().mockResolvedValue({
          id: factSetId,
          productId: parseProductId(prodId),
          workspaceId: parseWorkspaceId(wsId),
          status: 'draft',
          version: 1,
        }),
      },
    });

    await expect(kickoffWorkOrder(validCommand, deps)).rejects.toThrow(
      WorkforceFactSetNotConfirmedError,
    );
  });

  it('rejects non-accepted source analysis', async () => {
    const deps = createMockDeps({
      analysisQuery: {
        getAnalysisById: vi.fn().mockResolvedValue({
          id: parseAnalysisId(analysisId),
          workspaceId: parseWorkspaceId(wsId),
          productId: parseProductId(prodId),
          status: 'generated',
          version: 1,
        }),
      },
    });

    await expect(kickoffWorkOrder(validCommand, deps)).rejects.toThrow(
      WorkforceAnalysisNotAcceptedError,
    );
  });

  it('binds source versions to contextPackage and deduplicates normalized analysis IDs', async () => {
    const deps = createMockDeps();
    const commandWithDuplicates = {
      ...validCommand,
      acceptedAnalysisIds: [analysisId, analysisId], // Duplicates
    };

    const res = await kickoffWorkOrder(commandWithDuplicates, deps);
    expect(res.replayed).toBe(false);
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.workOrder)).toBe(true);

    const callArgs = (
      deps.workforcePersistence.kickoffWorkOrderAtomic as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]?.[0] as unknown as {
      contextPackage: {
        productVersion: number;
        factSetVersion: number;
        sourceAnalyses: readonly { id: string; version: number }[];
      };
    };

    expect(callArgs.contextPackage.productVersion).toBe(1);
    expect(callArgs.contextPackage.factSetVersion).toBe(1);
    expect(callArgs.contextPackage.sourceAnalyses).toHaveLength(1);
    expect(Object.isFrozen(callArgs.contextPackage.sourceAnalyses)).toBe(true);
  });

  it('defensively copies input arrays so caller mutation cannot affect execution', async () => {
    const deps = createMockDeps();
    const inputAnalyses = [analysisId];
    const mutableCommand = {
      ...validCommand,
      acceptedAnalysisIds: inputAnalyses,
    };

    const promise = kickoffWorkOrder(mutableCommand, deps);
    inputAnalyses.push('018f0000-0000-7000-8000-000000000099'); // Caller mutates during/after
    const res = await promise;

    expect(res.workOrder).toBeDefined();
    const callArgs = (
      deps.workforcePersistence.kickoffWorkOrderAtomic as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]?.[0] as unknown as {
      contextPackage: { sourceAnalyses: readonly { id: string; version: number }[] };
    };
    expect(callArgs.contextPackage.sourceAnalyses).toEqual([{ id: analysisId, version: 1 }]);
  });

  it('rejects source analysis belonging to another product', async () => {
    const deps = createMockDeps({
      analysisQuery: {
        getAnalysisById: vi.fn().mockResolvedValue({
          id: parseAnalysisId(analysisId),
          workspaceId: parseWorkspaceId(wsId),
          productId: parseProductId('018f0000-0000-7000-8000-000000000088'),
          status: 'accepted',
          version: 1,
        }),
      },
    });

    await expect(kickoffWorkOrder(validCommand, deps)).rejects.toThrow(
      WorkforceAnalysisNotAcceptedError,
    );
  });
});
