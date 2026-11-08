import { describe, expect, it } from 'vitest';
import {
  parseAIRunId,
  parseIsoTimestamp,
  parseJobExecutionId,
  parseOperationId,
  parseWorkspaceId,
  type JobExecutionSnapshot,
} from '@affiliate-content-os/domain';
import type {
  AIGatewayPort,
  AIRunPersistencePort,
  AnalysisPersistencePort,
  CatalogPersistencePort,
  OperationPersistencePort,
  PersistExecutionResultTransactionPort,
} from '@affiliate-content-os/application';
import { processJobExecution } from '../src/job-processor.js';
import type { JobProcessorDependencies } from '../src/job-processor-types.js';
import {
  parseAndValidateWorkforcePlanningPayload,
  crossCheckWorkforcePlanningPayload,
} from '../src/workforce-payload-validator.js';
import { validateWorkforceArtifactOutput } from '../src/workforce-output-validator.js';

describe('Workforce Worker Execution Components', () => {
  const wsId = '019318b2-5f33-722e-a5df-036f007b89f7';
  const prodId = '019318b2-5f33-722e-a5df-036f007b89f8';
  const woId = '019318b2-5f33-722e-a5df-036f007b89f9';
  const wiId = '019318b2-5f33-722e-a5df-036f007b89fa';
  const opId = '019318b2-5f33-722e-a5df-036f007b89fb';
  const runId = '019318b2-5f33-722e-a5df-036f007b89fc';
  const jobId = '019318b2-5f33-722e-a5df-036f007b89fd';
  const factId = '019318b2-5f33-722e-a5df-036f007b89fe';
  const cpId = '019318b2-5f33-722e-a5df-036f007b89f0';
  const userId = '019318b2-5f33-722e-a5df-036f007b89f1';

  const validPayload = {
    workspaceId: wsId,
    productId: prodId,
    workOrderId: woId,
    workItemId: wiId,
    taskKey: 'product_strategy' as const,
    roleKey: 'product_strategist' as const,
    operationId: opId,
    aiRunId: runId,
    contextPackageId: cpId,
    actorUserId: userId,
    reservedMicrounits: 50000,
  };

  function createMockJobSnapshot(
    payload: Record<string, unknown>,
    overrides: Partial<JobExecutionSnapshot> = {},
  ): JobExecutionSnapshot {
    const ts = parseIsoTimestamp('2026-11-08T05:00:00.000Z');
    return {
      id: parseJobExecutionId(jobId),
      workspaceId: parseWorkspaceId(wsId),
      operationId: parseOperationId(opId),
      aiRunId: parseAIRunId(runId),
      jobType: 'workforce_planning',
      deduplicationKey: 'dedup-1',
      status: 'running',
      attempt: 1,
      maxAttempts: 3,
      repairAttempt: 0,
      maxRepairAttempts: 1,
      leaseOwner: 'worker-1',
      leaseExpiresAt: parseIsoTimestamp('2026-11-08T06:00:00.000Z'),
      nextAttemptAt: ts,
      startedAt: ts,
      completedAt: null,
      lastErrorCategory: null,
      correlationId: null,
      reservedSpendMicrounits: 50000,
      payloadJson: payload,
      createdAt: ts,
      updatedAt: ts,
      version: 1,
      ...overrides,
    };
  }

  it('validates and cross-checks workforce planning payload', () => {
    const parsed = parseAndValidateWorkforcePlanningPayload(validPayload);
    expect(parsed.taskKey).toBe('product_strategy');

    const jobSnapshot = createMockJobSnapshot(validPayload);

    expect(() => crossCheckWorkforcePlanningPayload(parsed, jobSnapshot)).not.toThrow();

    expect(() =>
      crossCheckWorkforcePlanningPayload(parsed, {
        ...jobSnapshot,
        operationId: parseOperationId('019318b2-5f33-722e-a5df-036f007b8999'),
      }),
    ).toThrow(/match/);
  });

  it('rejects payload with invalid UUIDs or unknown keys', () => {
    expect(() =>
      parseAndValidateWorkforcePlanningPayload({ ...validPayload, workspaceId: 'not-a-uuid' }),
    ).toThrow();

    expect(() =>
      parseAndValidateWorkforcePlanningPayload({
        ...validPayload,
        taskKey: 'unknown_task' as unknown as 'product_strategy',
      }),
    ).toThrow();
  });

  it('validates artifact output and ensures evidence references point to valid sources', () => {
    const validFacts = new Set([factId.toLowerCase()]);
    const validAnalyses = new Set<string>();

    const content = {
      schemaVersion: 1,
      summary: 'Comprehensive launch campaign plan focused on productivity benefits.',
      positioningStatement: 'The premier all-in-one content commerce platform for modern teams.',
      campaignGoals: ['Increase qualified leads by 25%'],
      coreBenefits: [
        {
          benefit: 'Automated workflow execution eliminates 80% of repetitive content drafting.',
          evidenceRefs: [factId],
        },
      ],
      targetObjections: [
        {
          objection: 'High price point',
          counterAngle: 'Pays for itself within 30 days',
          evidenceRefs: [factId],
        },
      ],
      complianceConstraints: ['No unsupported claims.'],
      creativeHypotheses: [
        {
          hypothesis: 'Focusing on time savings drives higher conversion',
          rationale: 'Validated by creator community sentiment',
        },
      ],
      evidenceReferences: [{ sourceKind: 'product_fact', sourceId: factId }],
    };

    const validated = validateWorkforceArtifactOutput(
      'product_strategy',
      content,
      validFacts,
      validAnalyses,
    );
    expect(validated.evidenceRefs).toHaveLength(1);
    expect(validated.evidenceRefs[0]?.sourceId).toBe(factId);

    // Reference not in validFacts throws
    expect(() =>
      validateWorkforceArtifactOutput('product_strategy', content, new Set(), validAnalyses),
    ).toThrow(/not found in confirmed facts/);
  });

  it('throws in processJobExecution if pool is missing for workforce_planning job', async () => {
    const jobSnapshot = createMockJobSnapshot(validPayload);

    const mockDeps: JobProcessorDependencies = {
      workerId: 'worker-1',
      gatewayPort: {} as unknown as AIGatewayPort,
      catalogPort: {} as unknown as CatalogPersistencePort,
      analysisPort: {} as unknown as AnalysisPersistencePort,
      aiRunPort: {} as unknown as AIRunPersistencePort,
      operationPort: {} as unknown as OperationPersistencePort,
      persistTxPort: {} as unknown as PersistExecutionResultTransactionPort,
    };

    await expect(processJobExecution(jobSnapshot, mockDeps)).rejects.toThrow(
      /Database pool required to process workforce_planning job/,
    );
  });
});
