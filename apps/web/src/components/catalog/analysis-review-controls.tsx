'use client';

import { useState, type ReactElement } from 'react';

interface AnalysisReviewControlsProps {
  readonly isSubmitting: boolean;
  readonly onAccept: () => Promise<void>;
  readonly onReject: (reason?: string) => Promise<void>;
}

export function AnalysisReviewControls({
  isSubmitting,
  onAccept,
  onReject,
}: AnalysisReviewControlsProps): ReactElement {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (!rejecting) {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setRejecting(true)}
          disabled={isSubmitting}
          className="btn btn-danger"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={isSubmitting}
          className="btn btn-primary"
        >
          {isSubmitting ? 'Accepting...' : 'Accept Analysis'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="rejection-reason" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
        Rejection Reason (Optional)
      </label>
      <textarea
        id="rejection-reason"
        rows={2}
        maxLength={2048}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Explain why this analysis is rejected (e.g. ungrounded claim, inappropriate tone)..."
        disabled={isSubmitting}
        className="form-input"
        style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}
      />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setRejecting(false)}
          disabled={isSubmitting}
          className="btn btn-secondary"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onReject(reason.trim().length > 0 ? reason.trim() : undefined)}
          disabled={isSubmitting}
          className="btn btn-danger"
        >
          {isSubmitting ? 'Confirming...' : 'Confirm Rejection'}
        </button>
      </div>
    </div>
  );
}
