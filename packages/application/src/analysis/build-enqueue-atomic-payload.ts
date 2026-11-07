import type {
  AIRunId,
  AIModelConfiguration,
  JobExecutionId,
  OperationId,
  ProductFactSetId,
  ProductId,
  UserId,
  WorkspaceId,
} from '@affiliate-content-os/domain';
import type { EnqueueAnalysisCommand } from './types.js';
import type { EnqueueAnalysisAtomicParams } from './transaction-ports.js';

export function buildEnqueueAtomicPayload(params: {
  readonly command: EnqueueAnalysisCommand;
  readonly wsId: WorkspaceId;
  readonly prodId: ProductId;
  readonly factSetId: ProductFactSetId;
  readonly actorId: UserId;
  readonly operationId: OperationId;
  readonly aiRunId: AIRunId;
  readonly jobId: JobExecutionId;
  readonly outboxId: string;
  readonly auditEventId: string;
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
  readonly location: string;
  readonly aiConfig: AIModelConfiguration;
  readonly estimatedCostMicrounits: number;
}): EnqueueAnalysisAtomicParams {
  const {
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
    aiConfig,
    estimatedCostMicrounits,
  } = params;

  return {
    operation: {
      id: operationId,
      workspaceId: wsId,
      operationType: `${command.analysisType}_analysis`,
      resourceType: 'product',
      resourceId: prodId,
      requestedByUserId: actorId,
    },
    aiRun: {
      id: aiRunId,
      workspaceId: wsId,
      operationId,
      purpose: `${command.analysisType}_analysis`,
      provider: aiConfig.provider,
      model: aiConfig.model,
      promptTemplate: aiConfig.promptTemplate,
      promptVersion: aiConfig.promptVersion,
      inputSchemaVersion: aiConfig.inputSchemaVersion,
      outputSchemaVersion: aiConfig.outputSchemaVersion,
      inputHash: requestHash,
      requestedByUserId: actorId,
    },
    job: {
      id: jobId,
      workspaceId: wsId,
      operationId,
      aiRunId,
      jobType: 'ai_analysis',
      deduplicationKey: `${command.analysisType}:${prodId}:${factSetId}:${Buffer.from(keyHash).toString('hex')}`,
      reservedSpendMicrounits: estimatedCostMicrounits,
      payloadJson: {
        operationId,
        aiRunId,
        workspaceId: wsId,
        productId: prodId,
        analysisType: command.analysisType,
        factSetId: factSetId,
        sourceAnalysisIds: command.sourceAnalysisIds ?? [],
        actorUserId: actorId,
        reservedMicrounits: estimatedCostMicrounits,
      },
    },
    outboxEvent: {
      id: outboxId,
      workspaceId: wsId,
      eventType: 'ai_analysis.enqueued',
      aggregateType: 'analysis',
      aggregateId: operationId,
      payloadJson: {
        operationId,
        aiRunId,
        jobId,
        productId: prodId,
        analysisType: command.analysisType,
      },
    },
    idempotency: {
      keyHash,
      requestHash,
      principalId: actorId,
      routeKey: `POST /api/v1/workspaces/${wsId}/products/${prodId}/analyses`,
      statusCode: 202,
      responseJson: { operationId, location, status: 'queued' },
      resourceId: operationId,
    },
    estimatedCostMicrounits,
    auditEvent: {
      id: auditEventId,
      workspaceId: wsId,
      actorUserId: actorId,
      action: 'ai_analysis.enqueued',
      resourceType: 'operation',
      resourceId: operationId,
      changesJson: {
        analysis_type: command.analysisType,
        product_id: prodId,
        fact_set_id: factSetId,
      },
    },
  };
}
