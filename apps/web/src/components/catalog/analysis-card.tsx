'use client';

import type { ReactElement } from 'react';
import type { AnalysisSummaryDTO } from '../../types/analysis.js';

interface AnalysisCardProps {
  readonly analysis: AnalysisSummaryDTO;
  readonly onView: (analysisId: string) => void;
}

export function AnalysisCard({ analysis, onView }: AnalysisCardProps): ReactElement {
  const isPending = analysis.status === 'generated';
  const isAccepted = analysis.status === 'accepted';
  const isRejected = analysis.status === 'rejected';

  return (
    <div
      className={`analysis-card card ${isPending ? 'card-pending' : ''}`}
      style={{
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '0.5rem',
        padding: '1rem',
        marginBottom: '0.75rem',
        backgroundColor: 'var(--card-bg, #ffffff)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.25rem',
            }}
          >
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                padding: '0.125rem 0.5rem',
                borderRadius: '0.25rem',
                backgroundColor: '#e0f2fe',
                color: '#0369a1',
              }}
            >
              {analysis.analysisType.toUpperCase()}
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '0.125rem 0.5rem',
                borderRadius: '0.25rem',
                backgroundColor: isAccepted ? '#dcfce7' : isRejected ? '#fee2e2' : '#fef3c7',
                color: isAccepted ? '#15803d' : isRejected ? '#b91c1c' : '#b45309',
              }}
            >
              {isAccepted ? 'Accepted' : isRejected ? 'Rejected' : 'Pending Review'}
            </span>
          </div>

          <div style={{ fontSize: '0.875rem', color: '#4b5563' }}>
            Fact Set Revision #{analysis.factSetRevision ?? 'unknown'} · Model:{' '}
            {analysis.model ?? 'unavailable'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.125rem' }}>
            Created: {new Date(analysis.createdAt).toLocaleString()}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onView(analysis.id)}
          className="btn btn-outline"
          style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
        >
          View Analysis
        </button>
      </div>

      {isPending && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            backgroundColor: '#fffbeb',
            border: '1px solid #fef3c7',
            color: '#92400e',
            fontSize: '0.75rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
          }}
        >
          <span>⚠️</span>
          <span>AI Generated — Unapproved / Unverified until reviewed by an editor</span>
        </div>
      )}
    </div>
  );
}
