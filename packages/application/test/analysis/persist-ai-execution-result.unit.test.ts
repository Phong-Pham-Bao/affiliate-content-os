import { describe, expect, it, vi } from 'vitest';
import {
  persistAIExecutionResult,
  type PersistAIExecutionResultCommand,
  type PersistAIExecutionResultDependencies,
  type PersistExecutionResultAtomicParams,
} from '../../src/index.js';
import {
  parseAIRunId,
  parseAnalysisId,
  parseJobExecutionId,
  parseOperationId,
  parseProductFactId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  parseIsoTimestamp,
  type AnalysisSnapshot,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';

describe('persistAIExecutionResult use case and orchestration', () => {
  const wsId = parseWorkspaceId('018f6c5b-21a4-789a-8def-000000000001');
  const opId = parseOperationId('018f6c5b-21a4-789a-8def-000000000002');
  const runId = parseAIRunId('018f6c5b-21a4-789a-8def-000000000003');
  const jobId = parseJobExecutionId('018f6c5b-21a4-789a-8def-000000000004');
  const prodId = parseProductId('018f6c5b-21a4-789a-8def-000000000005');
  const factSetId = parseProductFactSetId('018f6c5b-21a4-789a-8def-000000000006');
  const userId = parseUserId('018f6c5b-21a4-789a-8def-000000000007');
  const factId = parseProductFactId('018f6c5b-21a4-789a-8def-000000000008');
  const sourceAnalysis1Id = parseAnalysisId('018f6c5b-21a4-789a-8def-000000000011');
  const sourceAnalysis2Id = parseAnalysisId('018f6c5b-21a4-789a-8def-000000000012');

  const confirmedFact: ProductFactSnapshot = {
    id: factId,
    workspaceId: wsId,
    productId: prodId,
    factSetId: factSetId,
    factKey: 'dimensions.weight',
    valueText: '850 grams',
    sourceType: 'user',
    sourceUrl: null,
    sourceExcerpt: null,
    confidence: 'confirmed',
    claimUsage: 'allowed',
    createdAt: parseIsoTimestamp('2026-11-06T00:00:00.000Z'),
  };

  const acceptedSourceAnalysis1: AnalysisSnapshot = {
    id: sourceAnalysis1Id,
    workspaceId: wsId,
    productId: prodId,
    analysisType: 'product',
    revisionNumber: 1,
    factSetId,
    aiRunId: runId,
    contentJson: { summary: 'Prior product analysis 1' },
    schemaVersion: 1,
    status: 'accepted',
    reviewedByUserId: userId,
    reviewedAt: parseIsoTimestamp('2026-11-06T01:00:00.000Z'),
    reviewReason: null,
    createdByUserId: userId,
    createdAt: parseIsoTimestamp('2026-11-06T00:30:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-06T01:00:00.000Z'),
    version: 2,
  };

  const acceptedSourceAnalysis2: AnalysisSnapshot = {
    id: sourceAnalysis2Id,
    workspaceId: wsId,
    productId: prodId,
    analysisType: 'product',
    revisionNumber: 2,
    factSetId,
    aiRunId: runId,
    contentJson: { summary: 'Prior product analysis 2' },
    schemaVersion: 1,
    status: 'accepted',
    reviewedByUserId: userId,
    reviewedAt: parseIsoTimestamp('2026-11-06T02:00:00.000Z'),
    reviewReason: null,
    createdByUserId: userId,
    createdAt: parseIsoTimestamp('2026-11-06T01:30:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-06T02:00:00.000Z'),
    version: 2,
  };

  const validProductContent = {
    summary: 'Mechanical keyboard summary',
    benefits: [
      {
        title: 'Lightweight build',
        description: 'Only 850 grams for portable ergonomics',
        evidenceFactIds: [factId],
      },
    ],
    differentiators: [
      {
        title: 'CNC Aluminum Case',
        description: 'Solid aluminum anodized body',
        evidenceFactIds: [factId],
      },
    ],
    evidenceGaps: [],
    claimRisks: [],
    objections: [
      {
        objection: 'Too heavy for plastic rival',
        counterArgument: 'Aluminum offers superior stability at 850 grams',
        evidenceFactIds: [factId],
      },
    ],
    contentAngles: [
      {
        angle: 'Digital nomad typing',
        targetPersona: 'Remote workers',
        hookText: 'Type anywhere',
        recommendedPoints: ['Portability', 'Weight'],
      },
    ],
  };

  function createMockDeps(): PersistAIExecutionResultDependencies {
    const capturedCalls: PersistExecutionResultAtomicParams[] = [];
    return {
      catalogPort: {
        findProductById: vi.fn(),
        findFactSetById: vi.fn().mockResolvedValue({
          factSet: {
            id: factSetId,
            workspaceId: wsId,
            productId: prodId,
            revisionNumber: 1,
            status: 'confirmed',
          },
          facts: [confirmedFact],
        }),
        createProduct: vi.fn(),
        updateProduct: vi.fn(),
        archiveProduct: vi.fn(),
        listProducts: vi.fn(),
        findProductByCanonicalUrlHash: vi.fn(),
        createFactSet: vi.fn(),
        confirmFactSet: vi.fn(),
        listFactSets: vi.fn(),
        createAffiliateDestination: vi.fn(),
        updateAffiliateDestination: vi.fn(),
        archiveAffiliateDestination: vi.fn(),
        findAffiliateDestinationById: vi.fn(),
        listAffiliateDestinations: vi.fn(),
      },
      analysisPort: {
        getAnalysisById: vi.fn().mockImplementation(async (_ws, id) => {
          if (id === sourceAnalysis1Id) return acceptedSourceAnalysis1;
          if (id === sourceAnalysis2Id) return acceptedSourceAnalysis2;
          return null;
        }),
        listAnalyses: vi.fn(),
        reviewAnalysisAtomic: vi.fn(),
      },
      aiRunPort: {
        getAIRunById: vi.fn().mockResolvedValue({
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        }),
      },
      persistTxPort: {
        persistExecutionResultAtomic: vi.fn().mockImplementation(async (params) => {
          capturedCalls.push(params);
          if (params.outcome.kind === 'success') return { outcome: 'succeeded' };
          if (params.outcome.kind === 'retry')
            return { outcome: 'retried', delaySeconds: params.outcome.retryDelaySeconds };
          if (params.outcome.kind === 'repair')
            return { outcome: 'repaired', delaySeconds: params.outcome.repairDelaySeconds };
          return { outcome: 'failed', errorCategory: params.outcome.errorCategory };
        }),
      },
      clock: { now: () => new Date('2026-11-06T12:00:00.000Z') },
    };
  }

  it('persists analysis and succeeds operation when AI result is valid', async () => {
    const deps = createMockDeps();
    const command: PersistAIExecutionResultCommand = {
      workspaceId: wsId,
      operationId: opId,
      aiRunId: runId,
      jobId,
      jobVersion: 1,
      workerId: 'worker-node-1',
      productId: prodId,
      analysisType: 'product',
      factSetId,
      actorUserId: userId,
      gatewayResult: {
        success: true,
        content: validProductContent,
        rawOutputHash: Buffer.alloc(32, 2),
        usage: {
          tokenInput: 500,
          tokenOutput: 300,
          costMicrounits: 45000,
          costCurrency: 'USD',
          latencyMs: 1200,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      },
      attemptCount: 1,
      reservedMicrounits: 50000,
    };

    const result = await persistAIExecutionResult(command, deps);

    expect(result.outcome).toBe('succeeded');
    expect(deps.persistTxPort.persistExecutionResultAtomic).toHaveBeenCalledOnce();
    const [call] = vi.mocked(deps.persistTxPort.persistExecutionResultAtomic).mock.calls;
    expect(call).toBeDefined();
    const params = call![0];
    expect(params.workerId).toBe('worker-node-1');
    expect(params.outcome.kind).toBe('success');
    if (params.outcome.kind === 'success') {
      expect(params.outcome.analysis).toBeDefined();
      expect(params.outcome.analysis.productId).toBe(prodId);
      expect(params.outcome.analysis.subjects).toHaveLength(2);
      expect(params.outcome.outputHash.byteLength).toBe(32);
    }
  });

  it('schedules bounded retry with exponential backoff on transient failure without failing run', async () => {
    const deps = createMockDeps();
    const command: PersistAIExecutionResultCommand = {
      workspaceId: wsId,
      operationId: opId,
      aiRunId: runId,
      jobId,
      jobVersion: 1,
      workerId: 'worker-node-1',
      productId: prodId,
      analysisType: 'product',
      factSetId,
      actorUserId: userId,
      gatewayResult: {
        success: false,
        errorCategory: 'provider_timeout',
        errorMessage: 'Gemini request timed out after 30s',
        usage: {
          tokenInput: 0,
          tokenOutput: 0,
          costMicrounits: 0,
          costCurrency: 'USD',
          latencyMs: 30000,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      },
      attemptCount: 1,
      reservedMicrounits: 50000,
    };

    const result = await persistAIExecutionResult(command, deps);

    expect(result.outcome).toBe('retried');
    expect(deps.persistTxPort.persistExecutionResultAtomic).toHaveBeenCalledOnce();
    const [call] = vi.mocked(deps.persistTxPort.persistExecutionResultAtomic).mock.calls;
    expect(call).toBeDefined();
    const params = call![0];
    expect(params.outcome.kind).toBe('retry');
    if (params.outcome.kind === 'retry') {
      expect(params.outcome.errorCategory).toBe('provider_timeout');
      expect(params.outcome.retryDelaySeconds).toBeGreaterThanOrEqual(5);
      expect(params.outcome.reservedMicrounits).toBe(50000);
    }
  });

  it('schedules exactly one repair on first invalid structured output', async () => {
    const deps = createMockDeps();
    const command: PersistAIExecutionResultCommand = {
      workspaceId: wsId,
      operationId: opId,
      aiRunId: runId,
      jobId,
      jobVersion: 1,
      workerId: 'worker-node-1',
      productId: prodId,
      analysisType: 'product',
      factSetId,
      actorUserId: userId,
      gatewayResult: {
        success: true,
        content: { broken: 'invalid structure' },
        usage: {
          tokenInput: 100,
          tokenOutput: 50,
          costMicrounits: 5000,
          costCurrency: 'USD',
          latencyMs: 800,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      },
      attemptCount: 1,
      repairAttemptCount: 0,
      reservedMicrounits: 50000,
    };

    const result = await persistAIExecutionResult(command, deps);

    expect(result.outcome).toBe('repaired');
    const [call] = vi.mocked(deps.persistTxPort.persistExecutionResultAtomic).mock.calls;
    expect(call).toBeDefined();
    const params = call![0];
    expect(params.outcome.kind).toBe('repair');
    if (params.outcome.kind === 'repair') {
      expect(params.outcome.errorCategory).toBe('invalid_output');
    }
  });

  it('marks terminal failure on second invalid structured output (repair exhausted)', async () => {
    const deps = createMockDeps();
    const command: PersistAIExecutionResultCommand = {
      workspaceId: wsId,
      operationId: opId,
      aiRunId: runId,
      jobId,
      jobVersion: 2,
      workerId: 'worker-node-1',
      productId: prodId,
      analysisType: 'product',
      factSetId,
      actorUserId: userId,
      gatewayResult: {
        success: true,
        content: { broken: 'second invalid structure' },
        usage: {
          tokenInput: 100,
          tokenOutput: 50,
          costMicrounits: 5000,
          costCurrency: 'USD',
          latencyMs: 800,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      },
      attemptCount: 2,
      repairAttemptCount: 1,
      reservedMicrounits: 50000,
    };

    const result = await persistAIExecutionResult(command, deps);

    expect(result.outcome).toBe('failed');
    const [call] = vi.mocked(deps.persistTxPort.persistExecutionResultAtomic).mock.calls;
    expect(call).toBeDefined();
    const params = call![0];
    expect(params.outcome.kind).toBe('terminal_failure');
    if (params.outcome.kind === 'terminal_failure') {
      expect(params.outcome.errorCategory).toBe('invalid_output');
      expect(params.outcome.errorCode).toBe('INVALID_STRUCTURED_OUTPUT');
    }
  });

  it('records invalid_evidence failure when affirmative claim cites unknown fact', async () => {
    const deps = createMockDeps();
    const command: PersistAIExecutionResultCommand = {
      workspaceId: wsId,
      operationId: opId,
      aiRunId: runId,
      jobId,
      jobVersion: 1,
      workerId: 'worker-node-1',
      productId: prodId,
      analysisType: 'product',
      factSetId,
      actorUserId: userId,
      gatewayResult: {
        success: true,
        content: {
          ...validProductContent,
          benefits: [
            {
              title: 'Unknown fact citation',
              description: 'Citing fact that does not exist',
              evidenceFactIds: ['018f6c5b-21a4-789a-8def-999999999999'],
            },
          ],
        },
        usage: {
          tokenInput: 500,
          tokenOutput: 300,
          costMicrounits: 45000,
          costCurrency: 'USD',
          latencyMs: 1200,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      },
      attemptCount: 1,
      reservedMicrounits: 50000,
    };

    const result = await persistAIExecutionResult(command, deps);

    expect(result.outcome).toBe('failed');
    const [call] = vi.mocked(deps.persistTxPort.persistExecutionResultAtomic).mock.calls;
    expect(call).toBeDefined();
    const params = call![0];
    expect(params.outcome.kind).toBe('terminal_failure');
    if (params.outcome.kind === 'terminal_failure') {
      expect(params.outcome.errorCategory).toBe('invalid_evidence');
    }
  });

  it('fails immediately when requested source analysis is missing, without silently skipping', async () => {
    const deps = createMockDeps();
    vi.mocked(deps.aiRunPort.getAIRunById).mockResolvedValue({
      provider: 'google',
      model: 'gemini-3.8-flash',
      promptTemplate: 'niche_analysis_v1',
      promptVersion: '1.0.0',
      inputSchemaVersion: 1,
      outputSchemaVersion: 1,
    } as Awaited<ReturnType<typeof deps.aiRunPort.getAIRunById>>);
    const command: PersistAIExecutionResultCommand = {
      workspaceId: wsId,
      operationId: opId,
      aiRunId: runId,
      jobId,
      jobVersion: 1,
      workerId: 'worker-node-1',
      productId: prodId,
      analysisType: 'niche',
      factSetId,
      sourceAnalysisIds: ['018f6c5b-21a4-789a-8def-000000000099'], // Missing source analysis
      actorUserId: userId,
      gatewayResult: {
        success: true,
        content: {
          targetAudience: [{ segment: 'Devs' }],
          pains: [
            {
              painPoint: 'Repetitive code',
              severity: 'high',
              context: 'Typing fatigue',
              evidenceFactIds: [factId],
            },
          ],
          intent: [{ queryOrTrigger: 'best keyboard', intentType: 'commercial' }],
          themes: [
            { theme: 'Ergonomics', description: 'Healthy joints', evidenceFactIds: [factId] },
          ],
          competitivePositioning: [
            {
              competitorOrAlternative: 'Membrane keyboard',
              differentiator: 'Mechanical switches',
              takeaway: 'Better feel',
              evidenceFactIds: [factId],
            },
          ],
          seasonalityNotes: [],
          risks: [],
        },
        usage: {
          tokenInput: 500,
          tokenOutput: 300,
          costMicrounits: 45000,
          costCurrency: 'USD',
          latencyMs: 1200,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'niche_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      },
      attemptCount: 1,
      reservedMicrounits: 50000,
    };

    const result = await persistAIExecutionResult(command, deps);

    expect(result.outcome).toBe('failed');
    const [call] = vi.mocked(deps.persistTxPort.persistExecutionResultAtomic).mock.calls;
    expect(call).toBeDefined();
    const params = call![0];
    expect(params.outcome.kind).toBe('terminal_failure');
    if (params.outcome.kind === 'terminal_failure') {
      expect(params.outcome.errorCategory).toBe('invalid_evidence');
      expect(params.outcome.errorCode).toBe('INVALID_SOURCE_ANALYSIS');
    }
  });
});
