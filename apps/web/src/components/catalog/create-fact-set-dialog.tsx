'use client';

import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import type {
  CreateFactSetPayload,
  FactClaimUsage,
  FactConfidence,
  FactInputPayload,
  FactSourceType,
} from '../../types/catalog.js';
import { generateCryptoIdempotencyKey } from '../../lib/crypto-idempotency.js';
import {
  createCanonicalPayloadSignature,
  IdempotencyKeyTracker,
} from '../../lib/catalog-idempotency.js';

interface CreateFactSetDialogProps {
  readonly onSave: (payload: CreateFactSetPayload, idempotencyKey: string) => Promise<void>;
  readonly onCancel: () => void;
}

interface FactRowState {
  id: string;
  factKey: string;
  valueText: string;
  sourceType: FactSourceType;
  sourceUrl: string;
  sourceExcerpt: string;
  confidence: FactConfidence;
  claimUsage: FactClaimUsage;
}

const DEFAULT_ROW = (): FactRowState => ({
  id: globalThis.crypto.randomUUID(),
  factKey: '',
  valueText: '',
  sourceType: 'user',
  sourceUrl: '',
  sourceExcerpt: '',
  confidence: 'suggested',
  claimUsage: 'allowed',
});

export function CreateFactSetDialog({ onSave, onCancel }: CreateFactSetDialogProps): ReactElement {
  const [summary, setSummary] = useState('');
  const [rows, setRows] = useState<FactRowState[]>([DEFAULT_ROW()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyTrackerRef = useRef<IdempotencyKeyTracker | null>(null);
  if (keyTrackerRef.current === null) {
    keyTrackerRef.current = new IdempotencyKeyTracker(generateCryptoIdempotencyKey);
  }
  const keyTracker = keyTrackerRef.current;

  const addRow = () => {
    if (rows.length >= 100) return;
    setRows((prev) => [...prev, DEFAULT_ROW()]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, patch: Partial<FactRowState>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const validateRows = (): string | null => {
    const keys = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const key = r.factKey.trim();
      const val = r.valueText.trim();
      if (!key) return `Fact #${i + 1} has an empty key`;
      if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(key) || key.length > 128) {
        return `Fact #${i + 1} key must be 1-128 lowercase alphanumeric segments separated by dots, underscores, or hyphens`;
      }
      if (!val) return `Fact #${i + 1} has an empty value`;
      if (keys.has(key)) return `Duplicate fact key: "${key}"`;
      keys.add(key);
    }
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const valErr = validateRows();
    if (valErr) {
      setError(valErr);
      return;
    }

    const facts: FactInputPayload[] = rows.map((r) => ({
      factKey: r.factKey.trim(),
      valueText: r.valueText.trim(),
      sourceType: r.sourceType,
      sourceUrl: r.sourceUrl.trim() ? r.sourceUrl.trim() : null,
      sourceExcerpt: r.sourceExcerpt.trim() ? r.sourceExcerpt.trim() : null,
      confidence: r.confidence,
      claimUsage: r.claimUsage,
    }));
    const payload: CreateFactSetPayload = {
      summary: summary.trim() ? summary.trim() : null,
      facts,
    };
    const key = keyTracker.getKey(createCanonicalPayloadSignature(payload));
    if (!key) {
      setError('Crypto RNG is unavailable. Please reload.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave(payload, key);
      keyTracker.clear();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to propose fact set.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="modal-content fact-dialog">
      <h3 className="modal-title">Propose New Fact Set Revision</h3>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="form-group">
          <label htmlFor="fact-set-summary">Revision Summary (optional)</label>
          <input
            id="fact-set-summary"
            type="text"
            maxLength={2048}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
            placeholder="e.g. Initial facts extracted from product specification"
          />
        </div>

        <div className="fact-rows-header">
          <h4>Fact Rows ({rows.length} / 100)</h4>
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= 100 || isSubmitting}
            className="btn-secondary btn-sm"
          >
            + Add Fact
          </button>
        </div>

        <div className="fact-rows-container">
          {rows.map((row, index) => (
            <div key={row.id} className="fact-row-editor">
              <div className="fact-row-top">
                <span className="fact-row-number">#{index + 1}</span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    disabled={isSubmitting}
                    className="btn-danger btn-sm"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="fact-grid">
                <div className="form-group">
                  <label htmlFor={`fact-key-${index}`}>Fact Key *</label>
                  <input
                    id={`fact-key-${index}`}
                    type="text"
                    required
                    maxLength={128}
                    value={row.factKey}
                    onChange={(e) => updateRow(index, { factKey: e.target.value })}
                    disabled={isSubmitting}
                    className="form-input"
                    placeholder="e.g. battery_life_hours"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`fact-source-type-${index}`}>Source Type</label>
                  <select
                    id={`fact-source-type-${index}`}
                    value={row.sourceType}
                    onChange={(e) =>
                      updateRow(index, { sourceType: e.target.value as FactSourceType })
                    }
                    disabled={isSubmitting}
                    className="form-select"
                  >
                    <option value="user">User</option>
                    <option value="merchant_page">Merchant Page</option>
                    <option value="document">Document</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor={`fact-confidence-${index}`}>Confidence</label>
                  <select
                    id={`fact-confidence-${index}`}
                    value={row.confidence}
                    onChange={(e) =>
                      updateRow(index, { confidence: e.target.value as FactConfidence })
                    }
                    disabled={isSubmitting}
                    className="form-select"
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="suggested">Suggested</option>
                    <option value="uncertain">Uncertain</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor={`fact-claim-usage-${index}`}>Claim Usage</label>
                  <select
                    id={`fact-claim-usage-${index}`}
                    value={row.claimUsage}
                    onChange={(e) =>
                      updateRow(index, { claimUsage: e.target.value as FactClaimUsage })
                    }
                    disabled={isSubmitting}
                    className="form-select"
                  >
                    <option value="allowed">Allowed</option>
                    <option value="context_only">Context Only</option>
                    <option value="prohibited">Prohibited</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor={`fact-val-${index}`}>Value Text *</label>
                <textarea
                  id={`fact-val-${index}`}
                  required
                  maxLength={10000}
                  rows={2}
                  value={row.valueText}
                  onChange={(e) => updateRow(index, { valueText: e.target.value })}
                  disabled={isSubmitting}
                  className="form-input"
                  placeholder="e.g. Up to 18 hours on a single charge"
                />
              </div>
              <div className="fact-grid">
                <div className="form-group">
                  <label htmlFor={`fact-url-${index}`}>Source URL (optional)</label>
                  <input
                    id={`fact-url-${index}`}
                    type="url"
                    maxLength={2048}
                    value={row.sourceUrl}
                    onChange={(e) => updateRow(index, { sourceUrl: e.target.value })}
                    disabled={isSubmitting}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`fact-excerpt-${index}`}>Source Excerpt (optional)</label>
                  <input
                    id={`fact-excerpt-${index}`}
                    type="text"
                    maxLength={2048}
                    value={row.sourceExcerpt}
                    onChange={(e) => updateRow(index, { sourceExcerpt: e.target.value })}
                    disabled={isSubmitting}
                    className="form-input"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting} className="btn-primary">
            {isSubmitting ? 'Proposing...' : 'Submit Proposed Fact Set'}
          </button>
        </div>
      </form>
    </div>
  );
}
