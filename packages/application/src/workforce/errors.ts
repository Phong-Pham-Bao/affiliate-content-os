import { ApplicationError } from '../errors.js';

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
