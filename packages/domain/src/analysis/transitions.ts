import { DomainValidationError } from '../errors.js';
import type { AnalysisStatus } from './types.js';

export type ReviewDecision = 'accepted' | 'rejected';

export type ReviewTransitionResult =
  | { readonly kind: 'transition'; readonly nextStatus: ReviewDecision }
  | { readonly kind: 'idempotent_no_op'; readonly currentStatus: ReviewDecision };

export function evaluateAnalysisReviewTransition(
  currentStatus: AnalysisStatus,
  decision: ReviewDecision,
): ReviewTransitionResult {
  if (currentStatus === 'generated') {
    return { kind: 'transition', nextStatus: decision };
  }

  if (currentStatus === decision) {
    return { kind: 'idempotent_no_op', currentStatus: decision };
  }

  if (currentStatus === 'accepted' || currentStatus === 'rejected') {
    throw new DomainValidationError(
      `Cannot change review status of analysis from "${currentStatus}" to "${decision}" (decisions are immutable)`,
      'status',
    );
  }

  throw new DomainValidationError(
    `Cannot review analysis with status "${currentStatus}"`,
    'status',
  );
}
