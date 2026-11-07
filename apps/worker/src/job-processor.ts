import crypto from 'node:crypto';
import type {
  AIGatewayPort,
  AIAnalysisGatewayResult,
  AIRunPersistencePort,
  AnalysisPersistencePort,
  CatalogPersistencePort,
  ClockPort,
  PersistExecutionResultTransactionPort,
  OperationPersistencePort,
} from '@affiliate-content-os/application';
import { persistAIExecutionResult, SystemClock } from '@affiliate-content-os/application';
import type { JobExecutionSnapshot } from '@affiliate-content-os/domain';
import {
  crossCheckJobPayload,
  parseAndValidateJobPayload,
  type ValidatedJobPayload,
} from './job-payload-validator.js';
import { reconstructAuthoritativeInput } from './input-reconstructor.js';

export interface JobProcessorDependencies {
  readonly workerId: string;
  readonly gatewayPort: AIGatewayPort;
  readonly catalogPort: CatalogPersistencePort;
  readonly analysisPort: AnalysisPersistencePort;
  readonly aiRunPort: AIRunPersistencePort;
  readonly operationPort: OperationPersistencePort;
  readonly persistTxPort: PersistExecutionResultTransactionPort;
  readonly clock?: ClockPort | undefined;
}

export async function processJobExecution(
  job: JobExecutionSnapshot,
  deps: JobProcessorDependencies,
): Promise<void> {
  let payload: ValidatedJobPayload;
  try {
    payload = parseAndValidateJobPayload(job.payloadJson);
    crossCheckJobPayload(payload, job);
  } catch {
    await deps.persistTxPort.persistExecutionResultAtomic({
      workspaceId: job.workspaceId,
      operationId: job.operationId,
      aiRunId: job.aiRunId,
      jobId: job.id,
      jobVersion: job.version,
      workerId: deps.workerId,
      outcome: {
        kind: 'terminal_failure',
        errorCategory: 'internal_error',
        errorCode: 'INVALID_JOB_PAYLOAD',
        errorMessage: 'Job payload failed schema validation',
        reservedMicrounits: job.reservedSpendMicrounits,
        actualSpendMicrounits: 0,
        auditEvent: {
          id: crypto.randomUUID(),
          workspaceId: job.workspaceId,
          actorUserId: null,
          actorType: 'system',
          action: 'ai_analysis.failed',
          resourceType: 'operation',
          resourceId: job.operationId,
          result: 'failed',
          changesJson: { error_code: 'INVALID_JOB_PAYLOAD' },
        },
      },
    });
    return;
  }

  const [operation, aiRun] = await Promise.all([
    deps.operationPort.getOperationById(payload.workspaceId, payload.operationId),
    deps.aiRunPort.getAIRunById(payload.workspaceId, payload.aiRunId),
  ]);
  const expectedOperationType =
    payload.analysisType === 'product' ? 'product_analysis' : 'niche_analysis';
  const expectedPromptTemplate =
    payload.analysisType === 'product' ? 'product_analysis_v1' : 'niche_analysis_v1';
  if (
    !operation ||
    operation.resourceType !== 'product' ||
    operation.resourceId !== payload.productId ||
    operation.requestedByUserId !== payload.actorUserId ||
    operation.operationType !== expectedOperationType ||
    !aiRun ||
    aiRun.operationId !== payload.operationId ||
    aiRun.requestedByUserId !== payload.actorUserId ||
    aiRun.purpose !== expectedOperationType ||
    aiRun.promptTemplate !== expectedPromptTemplate
  ) {
    await deps.persistTxPort.persistExecutionResultAtomic({
      workspaceId: payload.workspaceId,
      operationId: payload.operationId,
      aiRunId: payload.aiRunId,
      jobId: job.id,
      jobVersion: job.version,
      workerId: deps.workerId,
      outcome: {
        kind: 'terminal_failure',
        errorCategory: 'internal_error',
        errorCode: 'INVALID_JOB_LINKAGE',
        errorMessage: 'Job linkage or AI run provenance validation failed',
        reservedMicrounits: payload.reservedMicrounits,
        actualSpendMicrounits: 0,
        auditEvent: {
          id: crypto.randomUUID(),
          workspaceId: payload.workspaceId,
          actorUserId: null,
          actorType: 'system',
          action: 'ai_analysis.failed',
          resourceType: 'operation',
          resourceId: payload.operationId,
          result: 'failed',
          changesJson: { error_code: 'INVALID_JOB_LINKAGE' },
        },
      },
    });
    return;
  }

  // Authoritative context validation: product and fact set must exist and be valid
  const product = await deps.catalogPort.findProductById({
    workspaceId: payload.workspaceId,
    productId: payload.productId,
  });
  if (!product || product.status === 'archived') {
    await deps.persistTxPort.persistExecutionResultAtomic({
      workspaceId: payload.workspaceId,
      operationId: payload.operationId,
      aiRunId: payload.aiRunId,
      jobId: job.id,
      jobVersion: job.version,
      workerId: deps.workerId,
      outcome: {
        kind: 'terminal_failure',
        errorCategory: 'invalid_evidence',
        errorCode: 'PRODUCT_NOT_AVAILABLE',
        errorMessage: 'Product not found or archived in workspace',
        reservedMicrounits: payload.reservedMicrounits,
        actualSpendMicrounits: 0,
        auditEvent: {
          id: crypto.randomUUID(),
          workspaceId: payload.workspaceId,
          actorUserId: payload.actorUserId,
          action: 'ai_analysis.failed',
          resourceType: 'operation',
          resourceId: payload.operationId,
          result: 'failed',
          changesJson: { error_code: 'PRODUCT_NOT_AVAILABLE' },
        },
      },
    });
    return;
  }

  // Reconstruct authoritative input from persistent store
  let authInput;
  try {
    authInput = await reconstructAuthoritativeInput(payload, deps.catalogPort, deps.analysisPort);
  } catch {
    const fakeGatewayResult: AIAnalysisGatewayResult<never> = {
      success: false,
      errorCategory: 'invalid_evidence',
      errorMessage: 'Authoritative evidence reconstruction failed',
      isTransient: false,
      usage: {
        tokenInput: 0,
        tokenOutput: 0,
        costMicrounits: 0,
        costCurrency: 'USD',
        latencyMs: 0,
      },
      provenance: {
        provider: 'google',
        model: 'gemini-3.8-flash',
        promptTemplate:
          payload.analysisType === 'product' ? 'product_analysis_v1' : 'niche_analysis_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
      },
    };
    await persistAIExecutionResult(
      {
        workspaceId: payload.workspaceId,
        operationId: payload.operationId,
        aiRunId: payload.aiRunId,
        jobId: job.id,
        jobVersion: job.version,
        workerId: deps.workerId,
        productId: payload.productId,
        factSetId: payload.factSetId,
        sourceAnalysisIds: payload.sourceAnalysisIds,
        analysisType: payload.analysisType,
        actorUserId: payload.actorUserId,
        gatewayResult: fakeGatewayResult,
        attemptCount: job.attempt,
        repairAttemptCount: job.repairAttempt,
        reservedMicrounits: payload.reservedMicrounits,
      },
      {
        persistTxPort: deps.persistTxPort,
        catalogPort: deps.catalogPort,
        analysisPort: deps.analysisPort,
        aiRunPort: deps.aiRunPort,
        clock: deps.clock ?? new SystemClock(),
      },
    );
    return;
  }

  const repairFeedback =
    job.repairAttempt > 0
      ? { errorCategory: job.lastErrorCategory ?? 'invalid_output' }
      : undefined;

  let gatewayResult: AIAnalysisGatewayResult<unknown>;
  try {
    if (payload.analysisType === 'product' && authInput.productInput) {
      gatewayResult = await deps.gatewayPort.executeProductAnalysis(
        authInput.productInput,
        repairFeedback,
      );
    } else if (payload.analysisType === 'niche' && authInput.nicheInput) {
      gatewayResult = await deps.gatewayPort.executeNicheAnalysis(
        authInput.nicheInput,
        repairFeedback,
      );
    } else {
      throw new Error(`Unsupported analysis configuration for job ${job.id}`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'AI Gateway call failed';
    gatewayResult = {
      success: false,
      errorCategory: 'provider_unavailable',
      errorMessage: errorMsg,
      isTransient: true,
      usage: {
        tokenInput: 0,
        tokenOutput: 0,
        costMicrounits: 0,
        costCurrency: 'USD',
        latencyMs: 0,
      },
      provenance: {
        provider: 'google',
        model: 'gemini-3.8-flash',
        promptTemplate:
          payload.analysisType === 'product' ? 'product_analysis_v1' : 'niche_analysis_v1',
        promptVersion: '1.0.0',
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
      },
    };
  }

  await persistAIExecutionResult(
    {
      workspaceId: payload.workspaceId,
      operationId: payload.operationId,
      aiRunId: payload.aiRunId,
      jobId: job.id,
      jobVersion: job.version,
      workerId: deps.workerId,
      productId: payload.productId,
      factSetId: payload.factSetId,
      sourceAnalysisIds: payload.sourceAnalysisIds,
      analysisType: payload.analysisType,
      actorUserId: payload.actorUserId,
      gatewayResult,
      attemptCount: job.attempt,
      repairAttemptCount: job.repairAttempt,
      reservedMicrounits: payload.reservedMicrounits,
    },
    {
      persistTxPort: deps.persistTxPort,
      catalogPort: deps.catalogPort,
      analysisPort: deps.analysisPort,
      aiRunPort: deps.aiRunPort,
      clock: deps.clock ?? new SystemClock(),
    },
  );
}
