import { ApplicationError } from '../errors.js';

export class AIDisabledError extends ApplicationError {
  public override readonly name = 'AIDisabledError';
  public readonly code = 'AI_DISABLED' as const;

  constructor(workspaceId?: string) {
    super(
      workspaceId
        ? `AI is disabled for workspace ${workspaceId}`
        : 'AI is disabled for this workspace',
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AIBudgetExhaustedError extends ApplicationError {
  public override readonly name = 'AIBudgetExhaustedError';
  public readonly code = 'AI_BUDGET_EXHAUSTED' as const;

  constructor(detail = 'Monthly AI budget exhausted for this workspace') {
    super(detail);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class FactSetNotConfirmedError extends ApplicationError {
  public override readonly name = 'FactSetNotConfirmedError';
  public readonly code = 'FACT_SET_NOT_CONFIRMED' as const;

  constructor(factSetId: string) {
    super(`Fact set is not confirmed: ${factSetId}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SourceAnalysisNotAcceptedError extends ApplicationError {
  public override readonly name = 'SourceAnalysisNotAcceptedError';
  public readonly code = 'SOURCE_ANALYSIS_NOT_ACCEPTED' as const;

  constructor(analysisId: string) {
    super(`Source analysis is not in accepted status: ${analysisId}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidStructuredOutputError extends ApplicationError {
  public override readonly name = 'InvalidStructuredOutputError';
  public readonly code = 'INVALID_STRUCTURED_OUTPUT' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EvidenceValidationError extends ApplicationError {
  public override readonly name = 'EvidenceValidationError';
  public readonly code = 'INVALID_EVIDENCE_REFERENCE' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AIProviderUnavailableError extends ApplicationError {
  public override readonly name = 'AIProviderUnavailableError';
  public readonly code = 'AI_PROVIDER_UNAVAILABLE' as const;

  constructor(message = 'AI provider is temporarily unavailable') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OperationFailedError extends ApplicationError {
  public override readonly name = 'OperationFailedError';
  public readonly code = 'OPERATION_FAILED' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ReviewConflictError extends ApplicationError {
  public override readonly name = 'ReviewConflictError';
  public readonly code = 'REVIEW_CONFLICT' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AnalysisNotFoundError extends ApplicationError {
  public override readonly name = 'AnalysisNotFoundError';
  public readonly code = 'ANALYSIS_NOT_FOUND' as const;

  constructor(analysisId?: string) {
    super(analysisId ? `Analysis not found: ${analysisId}` : 'Analysis not found');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OperationNotFoundError extends ApplicationError {
  public override readonly name = 'OperationNotFoundError';
  public readonly code = 'OPERATION_NOT_FOUND' as const;

  constructor(operationId?: string) {
    super(operationId ? `Operation not found: ${operationId}` : 'Operation not found');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AIRateLimitExceededError extends ApplicationError {
  public override readonly name = 'AIRateLimitExceededError';
  public readonly code = 'RATE_LIMITED' as const;

  constructor(detail = 'Rate limit per minute exceeded for this workspace') {
    super(detail);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class JobLeaseExpiredError extends ApplicationError {
  public override readonly name = 'JobLeaseExpiredError';
  public readonly code = 'JOB_LEASE_EXPIRED' as const;

  constructor(jobId?: string) {
    super(jobId ? `Job lease expired or fenced: ${jobId}` : 'Job lease expired or fenced');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
