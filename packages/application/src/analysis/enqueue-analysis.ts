import { createHash } from 'node:crypto';
import {
  parseAIRunId,
  parseAuditEventId,
  parseJobExecutionId,
  parseOperationId,
  parseOutboxEventId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
} from '@affiliate-content-os/domain';
import { generateUuidV7 } from '../id-generator.js';
import { buildEnqueueAtomicPayload } from './build-enqueue-atomic-payload.js';
import {
  validateAIModelConfig,
  validateEnqueueAnalysisCommand,
  verifyAnalysisPrerequisites,
} from './enqueue-analysis-helpers.js';
import type {
  EnqueueAnalysisCommand,
  EnqueueAnalysisDependencies,
  EnqueueAnalysisResult,
} from './types.js';

export {
  type EnqueueAnalysisCommand,
  type EnqueueAnalysisDependencies,
  type EnqueueAnalysisResult,
};

export async function enqueueAnalysis(
  rawCommand: EnqueueAnalysisCommand,
  deps: EnqueueAnalysisDependencies,
): Promise<EnqueueAnalysisResult> {
  const command = validateEnqueueAnalysisCommand(rawCommand);
  const validatedConfig = validateAIModelConfig(deps.aiModelConfig);
  const wsId = parseWorkspaceId(command.workspaceId);
  const prodId = parseProductId(command.productId);
  const factSetId = parseProductFactSetId(command.factSetId);
  const actorId = parseUserId(command.actorUserId);

  // 1. Verify prerequisites (auth, product status, fact set status, source analyses)
  await verifyAnalysisPrerequisites(command, deps, wsId, prodId, factSetId, actorId);

  // 2. Canonical hashes
  const keyHash = createHash('sha256').update(command.idempotencyKey).digest();
  const canonicalRequestPayload = JSON.stringify({
    analysisType: command.analysisType,
    factSetId: command.factSetId,
    productId: command.productId,
    sourceAnalysisIds: command.sourceAnalysisIds ?? [],
    workspaceId: command.workspaceId,
  });
  const requestHash = createHash('sha256').update(canonicalRequestPayload).digest();

  // 3. Generate IDs
  const genId = () => deps.idGenerator?.generateId?.() ?? generateUuidV7();
  const operationId = parseOperationId(genId());
  const aiRunId = parseAIRunId(genId());
  const jobId = parseJobExecutionId(genId());
  const outboxId = parseOutboxEventId(genId());
  const auditEventId = parseAuditEventId(genId());

  const location = `/api/v1/workspaces/${command.workspaceId}/operations/${operationId}`;

  // 4. Build atomic enqueue payload
  const atomicParams = buildEnqueueAtomicPayload({
    command,
    wsId,
    prodId,
    factSetId,
    actorId,
    operationId,
    aiRunId,
    jobId,
    outboxId,
    auditEventId,
    keyHash,
    requestHash,
    location,
    aiConfig: validatedConfig,
    estimatedCostMicrounits: validatedConfig.estimatedCostMicrounits,
  });

  // 5. Execute atomic database transaction
  const result = await deps.enqueueTxPort.enqueueAnalysisAtomic(atomicParams);

  if (result.cached) {
    return {
      operationId: result.operationId,
      location: `/api/v1/workspaces/${command.workspaceId}/operations/${result.operationId}`,
    };
  }

  return { operationId, location };
}
