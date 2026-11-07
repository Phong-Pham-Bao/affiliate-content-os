import { describe, expect, it, vi } from 'vitest';
import { runWorker } from '../src/worker.js';
import type {
  AIGatewayPort,
  AIRunPersistencePort,
  OperationPersistencePort,
  AnalysisPersistencePort,
  CatalogPersistencePort,
  DurableJobQueuePort,
  PersistExecutionOutcome,
  PersistExecutionResultTransactionPort,
} from '@affiliate-content-os/application';
import type { ProductAnalysisContent } from '@affiliate-content-os/domain';
import {
  aiConfig,
  baseConfig,
  factSetId,
  makeMockJob,
  opId,
  prodId,
  userId,
  wsId,
} from './helpers/worker-execution-fixtures.js';

describe('Worker Execution Loop', () => {
  const aiRunPort = {
    getAIRunById: vi.fn().mockResolvedValue({
      operationId: opId,
      requestedByUserId: userId,
      purpose: 'product_analysis',
      provider: 'google',
      model: 'gemini-3.8-flash',
      promptTemplate: 'product_analysis_v1',
      promptVersion: '1.0.0',
      inputSchemaVersion: 1,
      outputSchemaVersion: 1,
    }),
  } as unknown as AIRunPersistencePort;
  const operationPort = {
    getOperationById: vi.fn().mockResolvedValue({
      workspaceId: wsId,
      operationType: 'product_analysis',
      resourceType: 'product',
      resourceId: prodId,
      requestedByUserId: userId,
    }),
  } as unknown as OperationPersistencePort;

  it('claims job, calls gateway, and persists success outcome atomically', async () => {
    const job = makeMockJob(0);
    const mockClaimNextJob = vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null);
    const mockJobAdapter: DurableJobQueuePort = {
      claimNextJob: mockClaimNextJob,
    };

    const mockCatalogPort = {
      findProductById: vi.fn().mockResolvedValue({
        id: prodId,
        workspaceId: wsId,
        name: 'Super Widget',
        merchantName: 'Acme',
        category: 'Electronics',
        description: 'Great widget',
        status: 'active',
      }),
      findFactSetById: vi.fn().mockResolvedValue({
        factSet: { id: factSetId, status: 'confirmed' },
        facts: [
          {
            id: '019318b2-5f33-722e-a5df-036f007b89f7',
            workspaceId: wsId,
            productId: prodId,
            factSetId,
            factKey: 'feature',
            valueText: 'Wireless',
            confidence: 'confirmed',
            claimUsage: 'allowed',
          },
        ],
      }),
    } as unknown as CatalogPersistencePort;

    const mockAnalysisPort = {
      getAnalysisById: vi.fn(),
    } as unknown as AnalysisPersistencePort;

    const mockGateway: AIGatewayPort = {
      executeProductAnalysis: vi.fn().mockResolvedValue({
        success: true,
        content: {
          summary: 'Super Widget summary',
          benefits: [
            {
              title: 'Wireless',
              description: 'No cords',
              evidenceFactIds: ['019318b2-5f33-722e-a5df-036f007b89f7'],
            },
          ],
          differentiators: [
            {
              title: 'Compact',
              description: 'Small footprint',
              evidenceFactIds: ['019318b2-5f33-722e-a5df-036f007b89f7'],
            },
          ],
          evidenceGaps: [],
          claimRisks: [],
          objections: [],
          contentAngles: [
            {
              angle: 'Tech',
              targetPersona: 'Geeks',
              hookText: 'Go wireless',
              recommendedPoints: ['Fast'],
            },
          ],
        },
        rawOutputHash: new Uint8Array(32),
        usage: {
          tokenInput: 100,
          tokenOutput: 150,
          costMicrounits: 0,
          costCurrency: 'USD',
          latencyMs: 200,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      }),
      executeNicheAnalysis: vi.fn(),
    };

    let persistedOutcome: PersistExecutionOutcome | null = null;
    const mockPersistTxPort: PersistExecutionResultTransactionPort = {
      persistExecutionResultAtomic: vi.fn().mockImplementation(async (params) => {
        persistedOutcome = params.outcome;
        return { outcome: 'succeeded' };
      }),
    };

    await runWorker({
      config: baseConfig,
      aiConfig,
      signal: new AbortController().signal,
      jobAdapter: mockJobAdapter,
      catalogPort: mockCatalogPort,
      analysisPort: mockAnalysisPort,
      aiRunPort,
      operationPort,
      persistTxPort: mockPersistTxPort,
      gatewayPort: mockGateway,
      once: true,
    });

    expect(mockClaimNextJob).toHaveBeenCalledTimes(1);
    expect(mockGateway.executeProductAnalysis).toHaveBeenCalledTimes(1);
    expect(mockPersistTxPort.persistExecutionResultAtomic).toHaveBeenCalledTimes(1);
    const outcome = persistedOutcome as PersistExecutionOutcome | null;
    expect(outcome).not.toBeNull();
    expect(outcome?.kind).toBe('success');
  });

  it('persists repair outcome on invalid output when repair attempt is 0', async () => {
    const job = makeMockJob(0);
    const mockClaimNextJob = vi.fn().mockResolvedValueOnce(job);
    const mockJobAdapter: DurableJobQueuePort = {
      claimNextJob: mockClaimNextJob,
    };

    const mockCatalogPort = {
      findProductById: vi.fn().mockResolvedValue({
        id: prodId,
        status: 'active',
        name: 'W',
        merchantName: 'A',
        category: 'C',
        description: 'D',
      }),
      findFactSetById: vi.fn().mockResolvedValue({ factSet: { status: 'confirmed' }, facts: [] }),
    } as unknown as CatalogPersistencePort;

    const mockGateway: AIGatewayPort = {
      executeProductAnalysis: vi.fn().mockResolvedValue({
        success: true,
        content: { invalid: 'schema' } as unknown as ProductAnalysisContent,
        usage: {
          tokenInput: 10,
          tokenOutput: 10,
          costMicrounits: 0,
          costCurrency: 'USD',
          latencyMs: 10,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      }),
      executeNicheAnalysis: vi.fn(),
    };

    let persistedOutcome: PersistExecutionOutcome | null = null;
    const mockPersistTxPort: PersistExecutionResultTransactionPort = {
      persistExecutionResultAtomic: vi.fn().mockImplementation(async (params) => {
        persistedOutcome = params.outcome;
        return { outcome: 'repaired' };
      }),
    };

    await runWorker({
      config: baseConfig,
      aiConfig,
      signal: new AbortController().signal,
      jobAdapter: mockJobAdapter,
      catalogPort: mockCatalogPort,
      analysisPort: { getAnalysisById: vi.fn() } as unknown as AnalysisPersistencePort,
      aiRunPort,
      operationPort,
      persistTxPort: mockPersistTxPort,
      gatewayPort: mockGateway,
      once: true,
    });

    const repairOutcome = persistedOutcome as PersistExecutionOutcome | null;
    expect(repairOutcome).not.toBeNull();
    expect(repairOutcome?.kind).toBe('repair');
  });

  it('persists terminal failure on second invalid output attempt', async () => {
    const job = makeMockJob(1); // repairAttempt = 1
    const mockClaimNextJob = vi.fn().mockResolvedValueOnce(job);
    const mockJobAdapter: DurableJobQueuePort = {
      claimNextJob: mockClaimNextJob,
    };

    const mockCatalogPort = {
      findProductById: vi.fn().mockResolvedValue({
        id: prodId,
        status: 'active',
        name: 'W',
        merchantName: 'A',
        category: 'C',
        description: 'D',
      }),
      findFactSetById: vi.fn().mockResolvedValue({ factSet: { status: 'confirmed' }, facts: [] }),
    } as unknown as CatalogPersistencePort;

    const mockGateway: AIGatewayPort = {
      executeProductAnalysis: vi.fn().mockResolvedValue({
        success: true,
        content: { still: 'invalid' } as unknown as ProductAnalysisContent,
        usage: {
          tokenInput: 10,
          tokenOutput: 10,
          costMicrounits: 0,
          costCurrency: 'USD',
          latencyMs: 10,
        },
        provenance: {
          provider: 'google',
          model: 'gemini-3.8-flash',
          promptTemplate: 'product_analysis_v1',
          promptVersion: '1.0.0',
          inputSchemaVersion: 1,
          outputSchemaVersion: 1,
        },
      }),
      executeNicheAnalysis: vi.fn(),
    };

    let persistedOutcome: PersistExecutionOutcome | null = null;
    const mockPersistTxPort: PersistExecutionResultTransactionPort = {
      persistExecutionResultAtomic: vi.fn().mockImplementation(async (params) => {
        persistedOutcome = params.outcome;
        return { outcome: 'failed' };
      }),
    };

    await runWorker({
      config: baseConfig,
      aiConfig,
      signal: new AbortController().signal,
      jobAdapter: mockJobAdapter,
      catalogPort: mockCatalogPort,
      analysisPort: { getAnalysisById: vi.fn() } as unknown as AnalysisPersistencePort,
      aiRunPort,
      operationPort,
      persistTxPort: mockPersistTxPort,
      gatewayPort: mockGateway,
      once: true,
    });

    const failureOutcome = persistedOutcome as PersistExecutionOutcome | null;
    expect(failureOutcome).not.toBeNull();
    expect(failureOutcome?.kind).toBe('terminal_failure');
    if (failureOutcome && failureOutcome.kind === 'terminal_failure') {
      expect(failureOutcome.errorCategory).toBe('invalid_output');
    }
  });
});
