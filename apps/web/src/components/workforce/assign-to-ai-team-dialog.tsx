'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import type { AnalysisSummaryDTO } from '../../types/analysis.js';
import type { FactDTO } from '../../types/catalog.js';
import type { KickoffWorkOrderPayload } from '../../types/workforce.js';
import { generateCryptoIdempotencyKey } from '../../lib/crypto-idempotency.js';
import { useEscapeKey } from '../../lib/use-escape-key.js';

interface AssignToAiTeamDialogProps {
  readonly isOpen: boolean;
  readonly canManage: boolean;
  readonly hasConfirmedFacts: boolean;
  readonly confirmedFacts: readonly FactDTO[];
  readonly acceptedAnalyses: readonly AnalysisSummaryDTO[];
  readonly aiEnabled: boolean;
  readonly availableBudgetMicrounits: number;
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (payload: KickoffWorkOrderPayload, idempotencyKey: string) => Promise<void>;
}

export function AssignToAiTeamDialog({
  isOpen,
  canManage,
  hasConfirmedFacts,
  confirmedFacts,
  acceptedAnalyses,
  aiEnabled,
  availableBudgetMicrounits,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: AssignToAiTeamDialogProps): ReactElement | null {
  useEscapeKey(onClose, isSubmitting, isOpen);

  const [directiveText, setDirectiveText] = useState(
    'Create a comprehensive product campaign plan, audience insight board, and 5-video series plan for our upcoming affiliate launch.',
  );
  const [priority, setPriority] = useState<number>(50);
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<string[]>(
    acceptedAnalyses.map((a) => a.id),
  );

  if (!isOpen) return null;

  const estimatedCostMicrounits = 150000; // 3 calls * 50,000 microunits = $0.15
  const hasEnoughBudget = availableBudgetMicrounits >= estimatedCostMicrounits;

  let disabledReason: string | null = null;
  if (!canManage) {
    disabledReason = 'Only workspace owners or editors can assign work to the AI team.';
  } else if (!aiEnabled) {
    disabledReason = 'AI features are disabled in workspace AI policy.';
  } else if (!hasConfirmedFacts) {
    disabledReason = 'A confirmed fact set is required before assigning to the AI team.';
  } else if (acceptedAnalyses.length === 0) {
    disabledReason = 'At least one accepted product or niche analysis is required.';
  } else if (!hasEnoughBudget) {
    disabledReason = 'Insufficient workspace AI budget for the estimated 3 planning calls.';
  }

  const isFormDisabled = Boolean(disabledReason) || isSubmitting;

  const handleToggleAnalysis = (id: string) => {
    setSelectedAnalysisIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isFormDisabled) return;

    const payload: KickoffWorkOrderPayload = {
      missionType: 'single_product_affiliate_launch',
      directiveText: directiveText.trim(),
      acceptedAnalysisIds: selectedAnalysisIds,
      priority,
    };
    const key = generateCryptoIdempotencyKey() ?? crypto.randomUUID();
    await onSubmit(payload, key);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-ai-title"
        className="modal-content workforce-assign-dialog"
      >
        <div className="modal-header">
          <h3 id="assign-ai-title" className="modal-title">
            Assign Mission to AI Team
          </h3>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        {disabledReason && (
          <div role="alert" className="alert-warning mb-4">
            {disabledReason}
          </div>
        )}

        {error && (
          <div role="alert" className="alert-danger mb-4">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-group mb-3">
            <label htmlFor="mission-type" className="form-label">
              Mission Template
            </label>
            <select
              id="mission-type"
              className="form-control"
              value="single_product_affiliate_launch"
              disabled
            >
              <option value="single_product_affiliate_launch">
                Single-Product Affiliate Launch (5 Videos, 3 Parallel Planners)
              </option>
            </select>
          </div>

          <div className="form-group mb-3">
            <label htmlFor="directive-text" className="form-label">
              Directive & Creative Brief (max 4,000 chars)
            </label>
            <textarea
              id="directive-text"
              className="form-control"
              rows={4}
              maxLength={4000}
              value={directiveText}
              onChange={(e) => setDirectiveText(e.target.value)}
              disabled={isFormDisabled}
              required
            />
            <span className="field-hint">{directiveText.length} / 4,000 characters</span>
          </div>

          <div className="form-group mb-3">
            <label htmlFor="priority-select" className="form-label">
              Priority
            </label>
            <select
              id="priority-select"
              className="form-control"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              disabled={isFormDisabled}
            >
              <option value={25}>Low (25)</option>
              <option value={50}>Normal (50)</option>
              <option value={75}>High (75)</option>
              <option value={100}>Critical (100)</option>
            </select>
          </div>

          <div className="form-group mb-3">
            <label className="form-label">Context: Selected Accepted Analyses</label>
            {acceptedAnalyses.length === 0 ? (
              <p className="text-muted text-sm">No accepted analyses available.</p>
            ) : (
              <div className="analysis-checkbox-group">
                {acceptedAnalyses.map((analysis) => (
                  <label key={analysis.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedAnalysisIds.includes(analysis.id)}
                      onChange={() => handleToggleAnalysis(analysis.id)}
                      disabled={isFormDisabled}
                    />
                    <span>
                      {analysis.analysisType === 'product' ? 'Product Analysis' : 'Niche Analysis'}{' '}
                      ({analysis.id.slice(0, 8)})
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="context-preview-box mb-4">
            <h4 className="preview-heading">Execution & Budget Summary</h4>
            <ul className="preview-list">
              <li>
                <strong>Planning Calls:</strong> 3 parallel calls (Product Strategist, Audience
                Strategist, Creative Director)
              </li>
              <li>
                <strong>Estimated Reservation:</strong> $
                {(estimatedCostMicrounits / 1000000).toFixed(2)} (150,000 microunits)
              </li>
              <li>
                <strong>Confirmed Facts:</strong> {confirmedFacts.length} verified facts will be
                locked into context package
              </li>
              <li>
                <strong>Downstream:</strong> Scriptwriter will be unlocked once all 3 plans complete
              </li>
            </ul>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isFormDisabled || !directiveText.trim()}
            >
              {isSubmitting ? 'Starting AI Team...' : 'Assign to AI Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
