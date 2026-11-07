import { DomainValidationError } from '../errors.js';
import { isValidUuidV7 } from '../ids.js';

declare const OperationIdBrand: unique symbol;
export type OperationId = string & { readonly [OperationIdBrand]: typeof OperationIdBrand };

declare const AIRunIdBrand: unique symbol;
export type AIRunId = string & { readonly [AIRunIdBrand]: typeof AIRunIdBrand };

declare const AnalysisIdBrand: unique symbol;
export type AnalysisId = string & { readonly [AnalysisIdBrand]: typeof AnalysisIdBrand };

declare const JobExecutionIdBrand: unique symbol;
export type JobExecutionId = string & {
  readonly [JobExecutionIdBrand]: typeof JobExecutionIdBrand;
};

declare const OutboxEventIdBrand: unique symbol;
export type OutboxEventId = string & { readonly [OutboxEventIdBrand]: typeof OutboxEventIdBrand };

function assertUuidV7(value: unknown, entityName: string, fieldName = 'id'): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError(`Invalid ${entityName} ID: must be a string`, fieldName);
  }
  if (!isValidUuidV7(value)) {
    throw new DomainValidationError(
      `Invalid ${entityName} ID: must be a canonical lowercase UUIDv7 string`,
      fieldName,
    );
  }
  return value;
}

export function isOperationId(value: unknown): value is OperationId {
  return isValidUuidV7(value);
}

export function parseOperationId(value: unknown, fieldName = 'operationId'): OperationId {
  return assertUuidV7(value, 'operation', fieldName) as OperationId;
}

export function isAIRunId(value: unknown): value is AIRunId {
  return isValidUuidV7(value);
}

export function parseAIRunId(value: unknown, fieldName = 'aiRunId'): AIRunId {
  return assertUuidV7(value, 'AI run', fieldName) as AIRunId;
}

export function isAnalysisId(value: unknown): value is AnalysisId {
  return isValidUuidV7(value);
}

export function parseAnalysisId(value: unknown, fieldName = 'analysisId'): AnalysisId {
  return assertUuidV7(value, 'analysis', fieldName) as AnalysisId;
}

export function isJobExecutionId(value: unknown): value is JobExecutionId {
  return isValidUuidV7(value);
}

export function parseJobExecutionId(value: unknown, fieldName = 'jobExecutionId'): JobExecutionId {
  return assertUuidV7(value, 'job execution', fieldName) as JobExecutionId;
}

export function isOutboxEventId(value: unknown): value is OutboxEventId {
  return isValidUuidV7(value);
}

export function parseOutboxEventId(value: unknown, fieldName = 'outboxEventId'): OutboxEventId {
  return assertUuidV7(value, 'outbox event', fieldName) as OutboxEventId;
}
