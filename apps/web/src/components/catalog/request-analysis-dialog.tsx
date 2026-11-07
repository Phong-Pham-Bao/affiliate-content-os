'use client';

import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { AnalysisSummaryDTO, EnqueueAnalysisPayload } from '../../types/analysis.js';
import { generateCryptoIdempotencyKey } from '../../lib/crypto-idempotency.js';
import { IdempotencyKeyTracker } from '../../lib/catalog-idempotency.js';

interface RequestAnalysisDialogProps {
  readonly productId: string;
  readonly factSetId: string | null;
  readonly factSetRevision?: number | null | undefined;
  readonly availableSourceAnalyses?: readonly AnalysisSummaryDTO[] | undefined;
  readonly onEnqueue: (payload: EnqueueAnalysisPayload, idempotencyKey: string) => Promise<void>;
  readonly onCancel: () => void;
}

export function RequestAnalysisDialog({
  factSetId,
  factSetRevision,
  availableSourceAnalyses = [],
  onEnqueue,
  onCancel,
}: RequestAnalysisDialogProps): ReactElement {
  const [analysisType, setAnalysisType] = useState<'product' | 'niche'>('product');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyTrackerRef = useRef<IdempotencyKeyTracker | null>(null);
  if (keyTrackerRef.current === null) {
    keyTrackerRef.current = new IdempotencyKeyTracker(generateCryptoIdempotencyKey);
  }
  const keyTracker = keyTrackerRef.current;

  const toggleSourceId = (id: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!factSetId) {
      setError('A confirmed fact set revision is required before requesting analysis.');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    const payload: EnqueueAnalysisPayload = {
      analysisType,
      factSetId,
      sourceAnalysisIds:
        analysisType === 'niche' && selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
    };

    try {
      const sig = JSON.stringify(payload);
      const idempotencyKey =
        keyTracker.getKey(sig) ?? generateCryptoIdempotencyKey() ?? globalThis.crypto.randomUUID();
      await onEnqueue(payload, idempotencyKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request analysis.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="dialog-content">
        <h2 id="dialog-title">Request AI Content Analysis</h2>

        {!factSetId ? (
          <div className="banner banner-warning" role="alert">
            Cannot request analysis: this product does not have a confirmed fact set revision.
            Please create and confirm a fact set first.
            <div className="dialog-actions" style={{ marginTop: '1rem' }}>
              <button type="button" onClick={onCancel} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="banner banner-error" role="alert">
                {error}
              </div>
            )}

            <div className="form-group">
              <label>Fact Set Revision</label>
              <p className="form-hint">Using confirmed fact set revision #{factSetRevision ?? 1}</p>
            </div>

            <div className="form-group">
              <label htmlFor="analysis-type-select">Analysis Type *</label>
              <select
                id="analysis-type-select"
                value={analysisType}
                onChange={(e) => setAnalysisType(e.target.value as 'product' | 'niche')}
                disabled={isSubmitting}
                className="form-input"
              >
                <option value="product">
                  Product Analysis (Benefits, Differentiators, Objections)
                </option>
                <option value="niche">Niche Synthesis (Market Context, Angles, Personas)</option>
              </select>
            </div>

            {analysisType === 'niche' && (
              <div className="form-group">
                <label>Accepted Source Analyses (Optional)</label>
                <p className="form-hint">
                  Select accepted product analyses to synthesize market angles:
                </p>
                {availableSourceAnalyses.length === 0 ? (
                  <p className="form-hint italic">No accepted product analyses found yet.</p>
                ) : (
                  <div
                    className="source-analyses-list"
                    style={{ maxHeight: '150px', overflowY: 'auto' }}
                  >
                    {availableSourceAnalyses.map((sa) => (
                      <label
                        key={sa.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          marginBottom: '0.25rem',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSourceIds.includes(sa.id)}
                          onChange={() => toggleSourceId(sa.id)}
                          disabled={isSubmitting}
                        />
                        <span>
                          Revision #{sa.factSetRevision ?? 'unknown'} ({sa.model ?? 'unavailable'})
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="dialog-actions">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSubmitting}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className="btn btn-primary">
                {isSubmitting ? 'Requesting...' : 'Request Analysis'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
