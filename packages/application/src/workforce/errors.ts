import { StaleVersionConflictError } from '../catalog/errors.js';
import { ApplicationError } from '../errors.js';

export { StaleVersionConflictError };

export class WorkOrderNotFoundError extends ApplicationError {
  public override readonly name = 'WorkOrderNotFoundError';
  public readonly code = 'WORK_ORDER_NOT_FOUND' as const;

  constructor(workOrderId: string) {
    super(`Work order not found: ${workOrderId}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkforceFactSetNotConfirmedError extends ApplicationError {
  public override readonly name = 'WorkforceFactSetNotConfirmedError';
  public readonly code = 'FACT_SET_NOT_CONFIRMED' as const;

  constructor(factSetId: string) {
    super(`Product fact set is not confirmed: ${factSetId}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkforceAnalysisNotAcceptedError extends ApplicationError {
  public override readonly name = 'WorkforceAnalysisNotAcceptedError';
  public readonly code = 'SOURCE_ANALYSIS_NOT_ACCEPTED' as const;

  constructor(analysisId: string) {
    super(`Source analysis is not accepted: ${analysisId}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkforceGraphValidationError extends ApplicationError {
  public override readonly name = 'WorkforceGraphValidationError';
  public readonly code = 'WORKFORCE_GRAPH_INVALID' as const;

  constructor(detail: string) {
    super(`Invalid workforce graph: ${detail}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkforceStaleContextError extends ApplicationError {
  public override readonly name = 'WorkforceStaleContextError';
  public readonly code = 'WORKFORCE_STALE_CONTEXT' as const;
  public readonly expectedVersion: number;
  public readonly actualVersion?: number | undefined;

  constructor(expectedVersion: number, actualVersion?: number) {
    super(
      actualVersion !== undefined
        ? `Workforce context version conflict: expected version ${expectedVersion}, but found version ${actualVersion}`
        : `Workforce context version conflict: expected version ${expectedVersion} does not match current version`,
    );
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ArtifactNotFoundError extends ApplicationError {
  public override readonly name = 'ArtifactNotFoundError';
  public readonly code = 'RESOURCE_NOT_FOUND' as const;

  constructor(artifactId: string) {
    super(`Artifact not found in workspace: ${artifactId}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ComplianceEvaluationNotFoundError extends ApplicationError {
  public override readonly name = 'ComplianceEvaluationNotFoundError';
  public readonly code = 'COMPLIANCE_EVALUATION_NOT_FOUND' as const;

  constructor(detail: string) {
    super(detail);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ComplianceBlockingFindingsError extends ApplicationError {
  public override readonly name = 'ComplianceBlockingFindingsError';
  public readonly code = 'COMPLIANCE_BLOCKING_FINDINGS' as const;
  public readonly blockingCount: number;

  constructor(blockingCount: number, message?: string) {
    super(
      message ?? `Precondition failed: content has ${blockingCount} blocking compliance finding(s)`,
    );
    this.blockingCount = blockingCount;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ComplianceEvaluationNotApprovableError extends ApplicationError {
  public override readonly name = 'ComplianceEvaluationNotApprovableError';
  public readonly code = 'COMPLIANCE_EVALUATION_NOT_APPROVABLE' as const;

  constructor(reason: string) {
    super(`Precondition failed: compliance evaluation is not approvable: ${reason}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ComplianceEvaluationStaleError extends ApplicationError {
  public override readonly name = 'ComplianceEvaluationStaleError';
  public readonly code = 'COMPLIANCE_EVALUATION_STALE' as const;

  constructor(detail: string) {
    super(`Precondition failed: compliance evaluation is stale: ${detail}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ContentReviewDecisionConflictError extends ApplicationError {
  public override readonly name = 'ContentReviewDecisionConflictError';
  public readonly code = 'CONTENT_REVIEW_DECISION_CONFLICT' as const;

  constructor(detail: string) {
    super(detail);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ArtifactRevisionConflictError extends ApplicationError {
  public override readonly name = 'ArtifactRevisionConflictError';
  public readonly code = 'VERSION_OR_REVISION_CONFLICT' as const;

  constructor(detail: string) {
    super(detail);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkOrderStateConflictError extends ApplicationError {
  public override readonly name = 'WorkOrderStateConflictError';
  public readonly code = 'WORK_ORDER_STATE_CONFLICT' as const;

  constructor(detail: string) {
    super(detail);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ChiefOfStaffAssignmentConflictError extends ApplicationError {
  public override readonly name = 'ChiefOfStaffAssignmentConflictError';
  public readonly code = 'CHIEF_OF_STAFF_ASSIGNMENT_CONFLICT' as const;

  constructor(detail: string) {
    super(detail);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
