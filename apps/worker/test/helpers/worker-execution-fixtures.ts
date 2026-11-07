import {
  parseAIRunId,
  parseIsoTimestamp,
  parseJobExecutionId,
  parseOperationId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type JobExecutionSnapshot,
} from '@affiliate-content-os/domain';
import { loadAIConfig, loadConfig } from '@affiliate-content-os/config';

export const wsId = parseWorkspaceId('019318b2-5f33-722e-a5df-036f007b89f0');
export const prodId = parseProductId('019318b2-5f33-722e-a5df-036f007b89f1');
export const factSetId = parseProductFactSetId('019318b2-5f33-722e-a5df-036f007b89f2');
export const opId = parseOperationId('019318b2-5f33-722e-a5df-036f007b89f3');
export const runId = parseAIRunId('019318b2-5f33-722e-a5df-036f007b89f4');
export const jobId = parseJobExecutionId('019318b2-5f33-722e-a5df-036f007b89f5');
export const userId = parseUserId('019318b2-5f33-722e-a5df-036f007b89f6');

export const baseConfig = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  API_HOST: '127.0.0.1',
  API_PORT: '3001',
});

export const aiConfig = loadAIConfig({
  NODE_ENV: 'test',
  AI_ENABLED: 'true',
  GEMINI_API_KEY: 'test-only-not-a-real-secret',
});

export function makeMockJob(repairAttempt = 0): JobExecutionSnapshot {
  return {
    id: jobId,
    workspaceId: wsId,
    operationId: opId,
    aiRunId: runId,
    jobType: 'ai_analysis',
    deduplicationKey: 'dedup-1',
    status: 'running',
    attempt: repairAttempt + 1,
    maxAttempts: 3,
    repairAttempt,
    maxRepairAttempts: 1,
    leaseOwner: 'worker-1',
    leaseExpiresAt: parseIsoTimestamp('2026-11-07T06:00:00.000Z'),
    nextAttemptAt: parseIsoTimestamp('2026-11-07T05:00:00.000Z'),
    startedAt: parseIsoTimestamp('2026-11-07T05:00:00.000Z'),
    completedAt: null,
    lastErrorCategory: repairAttempt > 0 ? 'invalid_output' : null,
    payloadJson: {
      operationId: opId,
      aiRunId: runId,
      workspaceId: wsId,
      productId: prodId,
      analysisType: 'product',
      factSetId: factSetId,
      sourceAnalysisIds: [],
      actorUserId: userId,
      reservedMicrounits: 50000,
    },
    correlationId: null,
    reservedSpendMicrounits: 50000,
    createdAt: parseIsoTimestamp('2026-11-07T05:00:00.000Z'),
    updatedAt: parseIsoTimestamp('2026-11-07T05:00:00.000Z'),
    version: 1,
  };
}
