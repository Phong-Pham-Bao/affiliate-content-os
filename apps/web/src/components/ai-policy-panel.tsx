'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { fetchAIPolicyApi, updateAIPolicyApi } from '../lib/catalog-api-client-analysis-actions.js';
import type { WorkspaceAIPolicyDTO } from '../types/analysis.js';

interface AIPolicyPanelProps {
  readonly workspaceId: string;
}

interface PolicyDraft {
  readonly aiEnabled: boolean;
  readonly monthlyBudgetMicrounits: string;
  readonly rateLimitPerMinute: string;
}

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function toDraft(policy: WorkspaceAIPolicyDTO): PolicyDraft {
  return {
    aiEnabled: policy.aiEnabled,
    monthlyBudgetMicrounits: String(policy.monthlyBudgetMicrounits),
    rateLimitPerMinute: String(policy.rateLimitPerMinute),
  };
}

function parseBoundedInteger(raw: string, label: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${integerFormatter.format(maximum)}.`);
  }
  return value;
}

export function AIPolicyPanel({ workspaceId }: AIPolicyPanelProps): ReactElement {
  const [policy, setPolicy] = useState<WorkspaceAIPolicyDTO | null>(null);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  const loadPolicy = async (signal?: AbortSignal): Promise<void> => {
    const sequence = ++loadSequenceRef.current;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const loaded = await fetchAIPolicyApi(workspaceId, signal);
      if (sequence !== loadSequenceRef.current || workspaceIdRef.current !== workspaceId) return;
      setPolicy(loaded);
      setDraft(toDraft(loaded));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (sequence !== loadSequenceRef.current || workspaceIdRef.current !== workspaceId) return;
      setPolicy(null);
      setDraft(null);
      setError(err instanceof Error ? err.message : 'Failed to load AI policy.');
    } finally {
      if (
        !signal?.aborted &&
        sequence === loadSequenceRef.current &&
        workspaceIdRef.current === workspaceId
      ) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setIsSaving(false);
    setPolicy(null);
    setDraft(null);
    void loadPolicy(controller.signal);
    return () => {
      controller.abort();
      loadSequenceRef.current += 1;
    };
  }, [workspaceId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!policy || !draft || isSaving) return;

    setError(null);
    setSuccess(null);
    let monthlyBudgetMicrounits: number;
    let rateLimitPerMinute: number;
    try {
      monthlyBudgetMicrounits = parseBoundedInteger(
        draft.monthlyBudgetMicrounits,
        'Monthly budget',
        0,
        Number.MAX_SAFE_INTEGER,
      );
      rateLimitPerMinute = parseBoundedInteger(draft.rateLimitPerMinute, 'Rate limit', 1, 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid policy values.');
      return;
    }

    setIsSaving(true);
    const savingWorkspaceId = workspaceId;
    try {
      const updated = await updateAIPolicyApi(
        workspaceId,
        { aiEnabled: draft.aiEnabled, monthlyBudgetMicrounits, rateLimitPerMinute },
        policy.version,
      );
      if (workspaceIdRef.current !== savingWorkspaceId) return;
      setPolicy(updated);
      setDraft(toDraft(updated));
      setSuccess('AI policy saved. New analysis requests will use this policy.');
    } catch (err: unknown) {
      if (workspaceIdRef.current !== savingWorkspaceId) return;
      setError(err instanceof Error ? err.message : 'Failed to save AI policy.');
    } finally {
      if (workspaceIdRef.current === savingWorkspaceId) setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <section className="ai-policy-panel" aria-labelledby="ai-policy-title">
        <h2 id="ai-policy-title">AI Policy &amp; Budget</h2>
        <div role="status" aria-live="polite">
          Loading AI policy...
        </div>
      </section>
    );
  }

  if (!policy || !draft) {
    return (
      <section className="ai-policy-panel" aria-labelledby="ai-policy-title">
        <h2 id="ai-policy-title">AI Policy &amp; Budget</h2>
        <div role="alert" className="error-banner">
          {error ?? 'AI policy is unavailable.'}
        </div>
        <button type="button" className="btn-secondary" onClick={() => void loadPolicy()}>
          Retry
        </button>
      </section>
    );
  }

  const remaining = Math.max(
    0,
    policy.monthlyBudgetMicrounits - policy.currentSpendMicrounits - policy.reservedSpendMicrounits,
  );

  return (
    <section className="ai-policy-panel" aria-labelledby="ai-policy-title">
      <div className="ai-policy-header">
        <div>
          <h2 id="ai-policy-title">AI Policy &amp; Budget</h2>
          <p>Owner controls for analysis availability, budget guardrails, and request rate.</p>
        </div>
        <span className="badge role-badge">Policy v{policy.version}</span>
      </div>

      <dl className="ai-policy-metrics" aria-label="AI budget usage">
        <div>
          <dt>Current spend</dt>
          <dd>{integerFormatter.format(policy.currentSpendMicrounits)}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{integerFormatter.format(policy.reservedSpendMicrounits)}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{integerFormatter.format(remaining)}</dd>
        </div>
        <div>
          <dt>Period start</dt>
          <dd>{new Date(policy.budgetPeriodStart).toLocaleDateString()}</dd>
        </div>
      </dl>

      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="success-banner">
          {success}
        </div>
      )}

      <form onSubmit={(event) => void handleSubmit(event)}>
        <div className="form-checkbox ai-policy-enabled">
          <label>
            <input
              type="checkbox"
              checked={draft.aiEnabled}
              disabled={isSaving}
              onChange={(event) => setDraft({ ...draft, aiEnabled: event.target.checked })}
            />
            Enable AI analysis for this workspace
          </label>
        </div>

        <div className="ai-policy-fields">
          <div className="form-group">
            <label htmlFor="ai-monthly-budget">Monthly budget (microunits)</label>
            <input
              id="ai-monthly-budget"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={draft.monthlyBudgetMicrounits}
              disabled={isSaving}
              onChange={(event) =>
                setDraft({ ...draft, monthlyBudgetMicrounits: event.target.value })
              }
              required
            />
            <small>
              Set 0 to block new AI requests. Values are policy units, not a payment charge.
            </small>
          </div>
          <div className="form-group">
            <label htmlFor="ai-rate-limit">Rate limit per minute</label>
            <input
              id="ai-rate-limit"
              type="number"
              inputMode="numeric"
              min="1"
              max="1000"
              step="1"
              value={draft.rateLimitPerMinute}
              disabled={isSaving}
              onChange={(event) => setDraft({ ...draft, rateLimitPerMinute: event.target.value })}
              required
            />
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={isSaving}
            onClick={() => void loadPolicy()}
          >
            Reload
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save AI Policy'}
          </button>
        </div>
      </form>
    </section>
  );
}
