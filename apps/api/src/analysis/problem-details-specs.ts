import type { ProblemSpec } from '../auth/problem-details-specs.js';
import {
  AIBudgetExhaustedError,
  AIDisabledError,
  AIProviderUnavailableError,
  AIRateLimitExceededError,
  AnalysisNotFoundError,
  FactSetNotConfirmedError,
  OperationNotFoundError,
  ReviewConflictError,
  SourceAnalysisNotAcceptedError,
} from '@affiliate-content-os/application';

export const ANALYSIS_PROBLEM_SPECS: Record<string, ProblemSpec> = {
  AI_DISABLED: {
    status: 403,
    code: 'AI_DISABLED',
    type: 'https://affiliate-content-os.example/problems/ai-disabled',
    title: 'Forbidden',
    detail: 'AI features are disabled for this workspace.',
  },
  AI_BUDGET_EXHAUSTED: {
    status: 429,
    code: 'AI_BUDGET_EXHAUSTED',
    type: 'https://affiliate-content-os.example/problems/ai-budget-exhausted',
    title: 'Too Many Requests',
    detail: 'Monthly AI budget for this workspace has been exhausted.',
  },
  AI_RATE_LIMITED: {
    status: 429,
    code: 'AI_RATE_LIMITED',
    type: 'https://affiliate-content-os.example/problems/ai-rate-limited',
    title: 'Too Many Requests',
    detail: 'Rate limit per minute exceeded for this workspace.',
  },
  FACT_SET_NOT_CONFIRMED: {
    status: 400,
    code: 'FACT_SET_NOT_CONFIRMED',
    type: 'https://affiliate-content-os.example/problems/fact-set-not-confirmed',
    title: 'Bad Request',
    detail: 'Fact set must be confirmed before running analysis.',
  },
  SOURCE_ANALYSIS_NOT_ACCEPTED: {
    status: 400,
    code: 'SOURCE_ANALYSIS_NOT_ACCEPTED',
    type: 'https://affiliate-content-os.example/problems/source-analysis-not-accepted',
    title: 'Bad Request',
    detail: 'Source analysis must be in accepted status.',
  },
  REVIEW_CONFLICT: {
    status: 409,
    code: 'REVIEW_CONFLICT',
    type: 'https://affiliate-content-os.example/problems/review-conflict',
    title: 'Conflict',
    detail: 'Analysis review conflict occurred.',
  },
  ANALYSIS_NOT_FOUND: {
    status: 404,
    code: 'ANALYSIS_NOT_FOUND',
    type: 'https://affiliate-content-os.example/problems/analysis-not-found',
    title: 'Not Found',
    detail: 'The requested analysis was not found or is not accessible.',
  },
  OPERATION_NOT_FOUND: {
    status: 404,
    code: 'OPERATION_NOT_FOUND',
    type: 'https://affiliate-content-os.example/problems/operation-not-found',
    title: 'Not Found',
    detail: 'The requested operation was not found or is not accessible.',
  },
  AI_PROVIDER_UNAVAILABLE: {
    status: 503,
    code: 'AI_PROVIDER_UNAVAILABLE',
    type: 'https://affiliate-content-os.example/problems/ai-provider-unavailable',
    title: 'Service Unavailable',
    detail: 'AI provider is temporarily unavailable.',
  },
};

export function resolveAnalysisProblemSpec(error: unknown): ProblemSpec | undefined {
  if (error instanceof AIDisabledError) return ANALYSIS_PROBLEM_SPECS['AI_DISABLED'];
  if (error instanceof AIBudgetExhaustedError) return ANALYSIS_PROBLEM_SPECS['AI_BUDGET_EXHAUSTED'];
  if (error instanceof AIRateLimitExceededError) return ANALYSIS_PROBLEM_SPECS['AI_RATE_LIMITED'];
  if (error instanceof FactSetNotConfirmedError)
    return ANALYSIS_PROBLEM_SPECS['FACT_SET_NOT_CONFIRMED'];
  if (error instanceof SourceAnalysisNotAcceptedError)
    return ANALYSIS_PROBLEM_SPECS['SOURCE_ANALYSIS_NOT_ACCEPTED'];
  if (error instanceof ReviewConflictError) return ANALYSIS_PROBLEM_SPECS['REVIEW_CONFLICT'];
  if (error instanceof AnalysisNotFoundError) return ANALYSIS_PROBLEM_SPECS['ANALYSIS_NOT_FOUND'];
  if (error instanceof OperationNotFoundError) return ANALYSIS_PROBLEM_SPECS['OPERATION_NOT_FOUND'];
  if (error instanceof AIProviderUnavailableError)
    return ANALYSIS_PROBLEM_SPECS['AI_PROVIDER_UNAVAILABLE'];
  return undefined;
}
