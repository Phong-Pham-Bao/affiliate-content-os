import { createHash } from 'node:crypto';
import {
  parseAnalysisId,
  type AIUsageSnapshot,
  type AnalysisId,
  type SafeFailureCategory,
} from '@affiliate-content-os/domain';
import { CreateAnalysisSubjectParams } from './analysis-persistence-port.js';
import type { PersistExecutionResultAtomicParams } from './transaction-ports.js';
import type { PersistAIExecutionResultCommand } from './types.js';

export function sanitizeErrorDetails(category: SafeFailureCategory): {
  readonly code: string;
  readonly message: string;
} {
  switch (category) {
    case 'ai_disabled':
      return { code: 'AI_DISABLED', message: 'AI features are not enabled for this workspace' };
    case 'budget_exhausted':
      return {
        code: 'BUDGET_EXHAUSTED',
        message: 'Workspace AI monthly budget has been exhausted',
      };
    case 'rate_limited':
      return { code: 'RATE_LIMITED', message: 'Workspace AI rate limit exceeded; retry shortly' };
    case 'provider_unavailable':
      return {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The AI provider service is temporarily unavailable',
      };
    case 'provider_timeout':
      return { code: 'PROVIDER_TIMEOUT', message: 'The AI provider request timed out' };
    case 'invalid_output':
      return {
        code: 'INVALID_OUTPUT',
        message: 'The AI provider returned output that failed schema validation',
      };
    case 'invalid_evidence':
      return {
        code: 'INVALID_EVIDENCE',
        message: 'AI output referenced unconfirmed, prohibited, or invalid evidence',
      };
    case 'internal_error':
    default:
      return { code: 'INTERNAL_ERROR', message: 'An internal error occurred during AI analysis' };
  }
}

export function validateGatewayUsage(rawUsage: unknown): AIUsageSnapshot | undefined {
  if (!rawUsage || typeof rawUsage !== 'object') {
    return undefined;
  }
  const u = rawUsage as Record<string, unknown>;
  const tokenInput =
    typeof u.tokenInput === 'number' &&
    Number.isSafeInteger(u.tokenInput) &&
    u.tokenInput >= 0 &&
    u.tokenInput <= 100_000_000
      ? u.tokenInput
      : 0;
  const tokenOutput =
    typeof u.tokenOutput === 'number' &&
    Number.isSafeInteger(u.tokenOutput) &&
    u.tokenOutput >= 0 &&
    u.tokenOutput <= 100_000_000
      ? u.tokenOutput
      : 0;
  const costMicrounits =
    typeof u.costMicrounits === 'number' &&
    Number.isSafeInteger(u.costMicrounits) &&
    u.costMicrounits >= 0
      ? u.costMicrounits
      : 0;
  const costCurrency =
    typeof u.costCurrency === 'string' &&
    u.costCurrency.trim().length >= 3 &&
    u.costCurrency.trim().length <= 10
      ? u.costCurrency.trim().toUpperCase()
      : 'USD';
  const latencyMs =
    typeof u.latencyMs === 'number' &&
    Number.isSafeInteger(u.latencyMs) &&
    u.latencyMs >= 0 &&
    u.latencyMs <= 3_600_000
      ? u.latencyMs
      : 0;

  return Object.freeze({
    tokenInput,
    tokenOutput,
    costMicrounits,
    costCurrency,
    latencyMs,
  });
}

function resolveDeterministicOutputHash(
  rawHash: Uint8Array | null | undefined,
  validatedContent: unknown,
): Uint8Array {
  if (rawHash instanceof Uint8Array && rawHash.byteLength === 32) {
    return rawHash;
  }
  return createHash('sha256').update(JSON.stringify(validatedContent)).digest();
}

export function buildFailureExecutionParams(
  command: PersistAIExecutionResultCommand,
  auditEventId: string,
  errorCat: SafeFailureCategory,
  customCode?: string,
  customMessage?: string,
): PersistExecutionResultAtomicParams {
  const sanitized = sanitizeErrorDetails(errorCat);
  const errorCode = customCode ?? sanitized.code;
  const errorMessage = customMessage ?? sanitized.message;
  const usage = validateGatewayUsage(command.gatewayResult.usage);

  return {
    workspaceId: command.workspaceId,
    operationId: command.operationId,
    aiRunId: command.aiRunId,
    jobId: command.jobId,
    jobVersion: command.jobVersion,
    workerId: command.workerId,
    outcome: {
      kind: 'terminal_failure',
      errorCategory: errorCat,
      errorCode,
      errorMessage,
      usage,
      reservedMicrounits: command.reservedMicrounits,
      actualSpendMicrounits: usage?.costMicrounits ?? 0,
      auditEvent: {
        id: auditEventId,
        workspaceId: command.workspaceId,
        actorUserId: command.actorUserId,
        action: 'ai_analysis.failed',
        resourceType: 'operation',
        resourceId: command.operationId,
        result: 'failed',
        changesJson: {
          error_category: errorCat,
          error_code: errorCode,
          analysis_type: command.analysisType,
        },
      },
    },
  };
}

export function buildRetryExecutionParams(
  command: PersistAIExecutionResultCommand,
  errorCat: 'provider_unavailable' | 'provider_timeout' | 'rate_limited',
  delaySeconds: number,
): PersistExecutionResultAtomicParams {
  return {
    workspaceId: command.workspaceId,
    operationId: command.operationId,
    aiRunId: command.aiRunId,
    jobId: command.jobId,
    jobVersion: command.jobVersion,
    workerId: command.workerId,
    outcome: {
      kind: 'retry',
      errorCategory: errorCat,
      retryDelaySeconds: delaySeconds,
      reservedMicrounits: command.reservedMicrounits,
    },
  };
}

export function buildRepairExecutionParams(
  command: PersistAIExecutionResultCommand,
  delaySeconds = 5,
): PersistExecutionResultAtomicParams {
  return {
    workspaceId: command.workspaceId,
    operationId: command.operationId,
    aiRunId: command.aiRunId,
    jobId: command.jobId,
    jobVersion: command.jobVersion,
    workerId: command.workerId,
    outcome: {
      kind: 'repair',
      errorCategory: 'invalid_output',
      repairDelaySeconds: delaySeconds,
      reservedMicrounits: command.reservedMicrounits,
    },
  };
}

export function buildSuccessExecutionParams(
  command: PersistAIExecutionResultCommand,
  auditEventId: string,
  analysisId: AnalysisId,
  validatedContent: unknown,
): PersistExecutionResultAtomicParams {
  const subjects: CreateAnalysisSubjectParams[] = [
    {
      subjectType: 'product',
      role: 'primary_subject',
      subjectProductId: command.productId,
    },
    {
      subjectType: 'fact_set',
      role: 'grounding_source',
      subjectProductId: command.productId,
      subjectFactSetId: command.factSetId,
    },
  ];

  if (command.sourceAnalysisIds) {
    for (const srcId of command.sourceAnalysisIds) {
      subjects.push({
        subjectType: 'analysis',
        role: 'input_analysis',
        subjectAnalysisId: parseAnalysisId(srcId),
      });
    }
  }

  const resultLocation = `/api/v1/workspaces/${command.workspaceId}/analyses/${analysisId}`;
  const outputHash = resolveDeterministicOutputHash(
    command.gatewayResult.rawOutputHash,
    validatedContent,
  );
  const usage = validateGatewayUsage(command.gatewayResult.usage);
  const safetyResult =
    typeof command.gatewayResult.safetyResult === 'string' &&
    command.gatewayResult.safetyResult.trim().length <= 128
      ? command.gatewayResult.safetyResult.trim()
      : null;

  return {
    workspaceId: command.workspaceId,
    operationId: command.operationId,
    aiRunId: command.aiRunId,
    jobId: command.jobId,
    jobVersion: command.jobVersion,
    workerId: command.workerId,
    outcome: {
      kind: 'success',
      analysis: {
        id: analysisId,
        workspaceId: command.workspaceId,
        productId: command.productId,
        analysisType: command.analysisType,
        factSetId: command.factSetId,
        aiRunId: command.aiRunId,
        contentJson: validatedContent,
        schemaVersion: 1,
        createdByUserId: command.actorUserId,
        subjects,
      },
      outputHash,
      usage,
      safetyResult,
      resultLocation,
      reservedMicrounits: command.reservedMicrounits,
      actualSpendMicrounits: usage?.costMicrounits ?? 0,
      auditEvent: {
        id: auditEventId,
        workspaceId: command.workspaceId,
        actorUserId: command.actorUserId,
        action: 'ai_analysis.succeeded',
        resourceType: 'operation',
        resourceId: command.operationId,
        result: 'succeeded',
        changesJson: {
          analysis_type: command.analysisType,
          analysis_id: analysisId,
        },
      },
    },
  };
}
