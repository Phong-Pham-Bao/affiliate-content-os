'use client';

import { useState, type ReactElement } from 'react';
import type { AnalysisDTO } from '../../types/analysis.js';
import { AnalysisReviewControls } from './analysis-review-controls.js';

interface AnalysisViewerModalProps {
  readonly analysis: AnalysisDTO;
  readonly onClose: () => void;
  readonly onAccept?: ((analysisId: string, version: number) => Promise<void>) | undefined;
  readonly onReject?:
    | ((analysisId: string, version: number, reason?: string | undefined) => Promise<void>)
    | undefined;
}

export function AnalysisViewerModal({
  analysis,
  onClose,
  onAccept,
  onReject,
}: AnalysisViewerModalProps): ReactElement {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isPending = analysis.status === 'generated';

  const handleAccept = async () => {
    if (!onAccept) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onAccept(analysis.id, analysis.version);
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to accept analysis.');
      setIsSubmitting(false);
    }
  };

  const handleReject = async (reason?: string) => {
    if (!onReject) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onReject(analysis.id, analysis.version, reason);
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject analysis.');
      setIsSubmitting(false);
    }
  };

  const content = analysis.content || {};

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="viewer-title">
      <div
        className="dialog-content"
        style={{ maxWidth: '750px', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h2 id="viewer-title" style={{ margin: 0 }}>
            {analysis.analysisType.toUpperCase()} Analysis
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem' }}
          >
            ✕
          </button>
        </div>

        {isPending && (
          <div className="banner banner-warning" role="alert" style={{ marginBottom: '1rem' }}>
            <strong>AI Generated — Unapproved / Unverified:</strong> All claims, differentiators,
            and citations below are AI-synthesized and must be verified before approval.
          </div>
        )}

        {actionError && (
          <div className="banner banner-error" role="alert">
            {actionError}
          </div>
        )}

        <div
          style={{
            backgroundColor: '#f9fafb',
            padding: '0.75rem',
            borderRadius: '0.375rem',
            fontSize: '0.8125rem',
            marginBottom: '1rem',
          }}
        >
          <div>
            <strong>Status:</strong> {analysis.status} · <strong>Revision:</strong> #
            {analysis.factSetRevision ?? 'unknown'} · <strong>Version:</strong> v{analysis.version}
          </div>
          <div>
            <strong>Model:</strong> {analysis.provider ?? 'unavailable'} /{' '}
            {analysis.model ?? 'unavailable'} {analysis.isRepair ? '(Repaired Run)' : ''}
          </div>
          {analysis.rejectionReason && (
            <div style={{ color: '#b91c1c' }}>
              <strong>Rejection Reason:</strong> {analysis.rejectionReason}
            </div>
          )}
        </div>

        <div className="structured-content" style={{ marginBottom: '1.5rem' }}>
          <pre
            style={{
              backgroundColor: '#f3f4f6',
              padding: '1rem',
              borderRadius: '0.375rem',
              overflowX: 'auto',
              fontSize: '0.8125rem',
            }}
          >
            {JSON.stringify(content, null, 2)}
          </pre>
        </div>

        {isPending && (onAccept || onReject) && (
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginBottom: '1rem' }}>
            <AnalysisReviewControls
              isSubmitting={isSubmitting}
              onAccept={handleAccept}
              onReject={handleReject}
            />
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
