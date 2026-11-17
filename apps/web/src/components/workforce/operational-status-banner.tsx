'use client';

import type { ReactElement } from 'react';
import type { WorkforceOverviewVM } from '../../lib/workforce-view-model-types.js';

interface OperationalStatusBannerProps {
  readonly overview: WorkforceOverviewVM;
  readonly isStale: boolean;
  readonly isRefreshing: boolean;
  readonly pollingError: string | null;
  readonly observationWarning?: string | null | undefined;
  readonly lastUpdatedAt: string | null;
  readonly onRefresh: () => void;
}

export function OperationalStatusBanner({
  overview,
  isStale,
  isRefreshing,
  pollingError,
  observationWarning,
  lastUpdatedAt,
  onRefresh,
}: OperationalStatusBannerProps): ReactElement | null {
  const formattedTime = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : null;

  return (
    <div
      className="operational-status-container my-2"
      role="region"
      aria-label="System Operational State"
    >
      {pollingError && (
        <div
          role="alert"
          className="alert alert-warning d-flex justify-content-between align-items-center p-3 mb-2 rounded"
        >
          <div>
            <strong>Observation Paused:</strong> {pollingError}. Existing data is preserved.
          </div>
          <button type="button" className="btn btn-sm btn-outline-dark" onClick={onRefresh}>
            Retry Refresh
          </button>
        </div>
      )}

      {observationWarning && !pollingError && (
        <div
          role="status"
          className="alert alert-warning d-flex justify-content-between align-items-center p-3 mb-2 rounded text-xs"
        >
          <div>
            <strong>Observation Warning:</strong> {observationWarning}. Existing data is preserved.
          </div>
          <button type="button" className="btn btn-sm btn-outline-dark" onClick={onRefresh}>
            Retry Sync
          </button>
        </div>
      )}

      {isStale && !pollingError && (
        <div
          role="status"
          className="alert alert-secondary d-flex justify-content-between align-items-center p-3 mb-2 rounded"
        >
          <div>
            <strong>Status Check Paused:</strong> Observation deadline reached. Click refresh for
            latest server state.
          </div>
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={onRefresh}>
            Refresh State
          </button>
        </div>
      )}

      {overview.humanActionRequired && (
        <div
          role="alert"
          className="alert alert-info d-flex justify-content-between align-items-center p-3 mb-2 rounded"
        >
          <div>
            <strong>Human Boss Action Needed:</strong> One or more deliverables require your review
            and decision.
          </div>
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center text-xs text-muted px-1">
        <div>
          {isRefreshing ? (
            <span className="badge badge-info animate-pulse me-2">Refreshing...</span>
          ) : (
            <span className="me-2">● Connected</span>
          )}
          {formattedTime && <span>Last synchronized: {formattedTime}</span>}
        </div>
        <div>
          <button
            type="button"
            className="btn btn-link btn-xs text-muted"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Manually refresh workforce status"
          >
            ↻ Manual Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
