import { describe, expect, it, vi } from 'vitest';
import {
  enqueueAnalysis,
  type EnqueueAnalysisCommand,
  type EnqueueAnalysisDependencies,
} from '../../src/index.js';
import {
  AIDisabledError,
  AIBudgetExhaustedError,
  FactSetNotConfirmedError,
  SourceAnalysisNotAcceptedError,
} from '../../src/analysis/errors.js';
import {
  ProductArchivedError,
  ProductNotFoundError,
  FactSetNotFoundError,
} from '../../src/catalog/errors.js';
import { ValidationError, WorkspaceAccessDeniedError } from '../../src/errors.js';

describe('enqueueAnalysis use case', () => {
  const wsId = '018f6c5b-21a4-789a-8def-000000000001';
  const prodId = '018f6c5b-21a4-789a-8def-000000000002';
  const factSetId = '018f6c5b-21a4-789a-8def-000000000003';
  const userId = '018f6c5b-21a4-789a-8def-000000000004';

  const defaultCommand: EnqueueAnalysisCommand = {
    workspaceId: wsId,
    productId: prodId,
    analysisType: 'product',
    factSetId,
    idempotencyKey: 'idemp-key-1',
    actorUserId: userId,
  };

  function createMockDeps(
    overrides?: Partial<EnqueueAnalysisDependencies>,
  ): EnqueueAnalysisDependencies {
    return {
      authPort: {
        findMembership: vi.fn().mockResolvedValue({
          id: '018f6c5b-21a4-789a-8def-000000000005',
          workspaceId: wsId,
          userId,
          role: 'editor',
          status: 'active',
          createdAt: '2026-11-06T00:00:00.000Z',
          updatedAt: '2026-11-06T00:00:00.000Z',
          version: 1,
        }),
      },
      catalogPort: {
        createProduct: vi.fn(),
        findProductById: vi.fn().mockResolvedValue({
          id: prodId,
          workspaceId: wsId,
          name: 'Keyboard',
          merchantName: 'Acme',
          canonicalUrl: 'https://example.com/k',
          canonicalUrlHash: Buffer.alloc(32, 1),
          category: 'Hardware',
          description: 'Desc',
          audienceNotes: null,
          allowedClaimsNotes: null,
          prohibitedClaimsNotes: null,
          status: 'active',
          currentFactSetId: factSetId,
          createdAt: '2026-11-06T00:00:00.000Z',
          updatedAt: '2026-11-06T00:00:00.000Z',
          version: 1,
        }),
        findProductByCanonicalUrlHash: vi.fn(),
        listProducts: vi.fn(),
        updateProduct: vi.fn(),
        archiveProduct: vi.fn(),
        createFactSet: vi.fn(),
        findFactSetById: vi.fn().mockResolvedValue({
          factSet: {
            id: factSetId,
            workspaceId: wsId,
            productId: prodId,
            revisionNumber: 1,
            status: 'confirmed',
            summary: 'Confirmed facts',
            createdByUserId: userId,
            confirmedByUserId: userId,
            confirmedAt: '2026-11-06T00:00:00.000Z',
            createdAt: '2026-11-06T00:00:00.000Z',
            updatedAt: '2026-11-06T00:00:00.000Z',
            version: 1,
          },
          facts: [],
        }),
        listFactSets: vi.fn(),
        confirmFactSet: vi.fn(),
        createAffiliateDestination: vi.fn(),
        findAffiliateDestinationById: vi.fn(),
        listAffiliateDestinations: vi.fn(),
        updateAffiliateDestination: vi.fn(),
        archiveAffiliateDestination: vi.fn(),
      },
      analysisPort: {
        getAnalysisById: vi.fn(),
        listAnalyses: vi.fn(),
        reviewAnalysisAtomic: vi.fn(),
      },
      aiModelConfig: {
        provider: 'test-provider',
        model: 'test-model',
        promptTemplate: 'product_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        estimatedCostMicrounits: 50000,
      },
      enqueueTxPort: {
        enqueueAnalysisAtomic: vi.fn().mockResolvedValue({
          operationId: '018f6c5b-21a4-789a-8def-000000000010',
          aiRunId: '018f6c5b-21a4-789a-8def-000000000020',
          jobId: '018f6c5b-21a4-789a-8def-000000000030',
        }),
      },
      clock: { now: () => new Date('2026-11-06T12:00:00.000Z') },
      ...overrides,
    };
  }

  it('enqueues analysis successfully when all preconditions pass', async () => {
    const deps = createMockDeps();
    const result = await enqueueAnalysis(defaultCommand, deps);

    expect(result.location).toContain(`/api/v1/workspaces/${wsId}/operations/`);
    expect(deps.enqueueTxPort.enqueueAnalysisAtomic).toHaveBeenCalledOnce();
  });

  it('rejects caller when not an active member or lacking catalog.manage role', async () => {
    const deps = createMockDeps({
      authPort: {
        findMembership: vi.fn().mockResolvedValue({
          id: '018f6c5b-21a4-789a-8def-000000000005',
          workspaceId: wsId,
          userId,
          role: 'viewer',
          status: 'active',
          createdAt: '2026-11-06T00:00:00.000Z',
          updatedAt: '2026-11-06T00:00:00.000Z',
          version: 1,
        }),
      },
    });

    await expect(enqueueAnalysis(defaultCommand, deps)).rejects.toThrow(WorkspaceAccessDeniedError);
  });

  it('rejects when product does not exist', async () => {
    const deps = createMockDeps({
      catalogPort: {
        ...createMockDeps().catalogPort,
        findProductById: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(enqueueAnalysis(defaultCommand, deps)).rejects.toThrow(ProductNotFoundError);
  });

  it('rejects when product is archived', async () => {
    const deps = createMockDeps({
      catalogPort: {
        ...createMockDeps().catalogPort,
        findProductById: vi.fn().mockResolvedValue({
          id: prodId,
          workspaceId: wsId,
          name: 'Archived Keyboard',
          merchantName: 'Acme',
          canonicalUrl: 'https://example.com/k',
          canonicalUrlHash: Buffer.alloc(32, 1),
          category: 'Hardware',
          description: 'Desc',
          audienceNotes: null,
          allowedClaimsNotes: null,
          prohibitedClaimsNotes: null,
          status: 'archived',
          currentFactSetId: factSetId,
          createdAt: '2026-11-06T00:00:00.000Z',
          updatedAt: '2026-11-06T00:00:00.000Z',
          version: 1,
        }),
      },
    });

    await expect(enqueueAnalysis(defaultCommand, deps)).rejects.toThrow(ProductArchivedError);
  });

  it('rejects when fact set does not exist', async () => {
    const deps = createMockDeps({
      catalogPort: {
        ...createMockDeps().catalogPort,
        findFactSetById: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(enqueueAnalysis(defaultCommand, deps)).rejects.toThrow(FactSetNotFoundError);
  });

  it('rejects when fact set is not confirmed', async () => {
    const deps = createMockDeps({
      catalogPort: {
        ...createMockDeps().catalogPort,
        findFactSetById: vi.fn().mockResolvedValue({
          factSet: {
            id: factSetId,
            workspaceId: wsId,
            productId: prodId,
            revisionNumber: 1,
            status: 'proposed',
            summary: 'Proposed facts',
            createdByUserId: userId,
            confirmedByUserId: null,
            confirmedAt: null,
            createdAt: '2026-11-06T00:00:00.000Z',
            updatedAt: '2026-11-06T00:00:00.000Z',
            version: 1,
          },
          facts: [],
        }),
      },
    });

    await expect(enqueueAnalysis(defaultCommand, deps)).rejects.toThrow(FactSetNotConfirmedError);
  });

  it('for niche analysis, rejects when source analysis is not accepted', async () => {
    const sourceId = '018f6c5b-21a4-789a-8def-000000000099';
    const deps = createMockDeps({
      analysisPort: {
        ...createMockDeps().analysisPort,
        getAnalysisById: vi.fn().mockResolvedValue({
          id: sourceId,
          workspaceId: wsId,
          productId: prodId,
          analysisType: 'product',
          revisionNumber: 1,
          factSetId,
          aiRunId: '018f6c5b-21a4-789a-8def-000000000020',
          contentJson: {},
          schemaVersion: 1,
          status: 'generated',
          reviewedByUserId: null,
          reviewedAt: null,
          reviewReason: null,
          createdByUserId: userId,
          createdAt: '2026-11-06T00:00:00.000Z',
          updatedAt: '2026-11-06T00:00:00.000Z',
          version: 1,
        }),
      },
    });

    await expect(
      enqueueAnalysis(
        {
          ...defaultCommand,
          analysisType: 'niche',
          sourceAnalysisIds: [sourceId],
        },
        deps,
      ),
    ).rejects.toThrow(SourceAnalysisNotAcceptedError);
  });

  it('rejects raw instructions in Phase 1 per contract', async () => {
    const deps = createMockDeps();
    await expect(
      enqueueAnalysis(
        {
          ...defaultCommand,
          instructions: 'make it exciting',
        } as never,
        deps,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('propagates AIDisabledError from transaction', async () => {
    const deps = createMockDeps({
      enqueueTxPort: {
        enqueueAnalysisAtomic: vi.fn().mockRejectedValue(new AIDisabledError(wsId)),
      },
    });

    await expect(enqueueAnalysis(defaultCommand, deps)).rejects.toThrow(AIDisabledError);
  });

  it('propagates AIBudgetExhaustedError from transaction', async () => {
    const deps = createMockDeps({
      enqueueTxPort: {
        enqueueAnalysisAtomic: vi.fn().mockRejectedValue(new AIBudgetExhaustedError()),
      },
    });

    await expect(enqueueAnalysis(defaultCommand, deps)).rejects.toThrow(AIBudgetExhaustedError);
  });
});
