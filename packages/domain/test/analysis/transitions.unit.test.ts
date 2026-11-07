import { describe, expect, it } from 'vitest';
import { DomainValidationError, evaluateAnalysisReviewTransition } from '../../src/index.js';

describe('analysis review transitions', () => {
  it('allows transition from generated to accepted', () => {
    const result = evaluateAnalysisReviewTransition('generated', 'accepted');
    expect(result).toEqual({ kind: 'transition', nextStatus: 'accepted' });
  });

  it('allows transition from generated to rejected', () => {
    const result = evaluateAnalysisReviewTransition('generated', 'rejected');
    expect(result).toEqual({ kind: 'transition', nextStatus: 'rejected' });
  });

  it('treats accepted -> accepted as idempotent no-op', () => {
    const result = evaluateAnalysisReviewTransition('accepted', 'accepted');
    expect(result).toEqual({ kind: 'idempotent_no_op', currentStatus: 'accepted' });
  });

  it('treats rejected -> rejected as idempotent no-op', () => {
    const result = evaluateAnalysisReviewTransition('rejected', 'rejected');
    expect(result).toEqual({ kind: 'idempotent_no_op', currentStatus: 'rejected' });
  });

  it('rejects accepted -> rejected with conflict error', () => {
    expect(() => evaluateAnalysisReviewTransition('accepted', 'rejected')).toThrow(
      DomainValidationError,
    );
  });

  it('rejects rejected -> accepted with conflict error', () => {
    expect(() => evaluateAnalysisReviewTransition('rejected', 'accepted')).toThrow(
      DomainValidationError,
    );
  });

  it('rejects reviewing unknown or invalid status', () => {
    expect(() => evaluateAnalysisReviewTransition('superseded' as never, 'accepted')).toThrow(
      DomainValidationError,
    );
  });
});
