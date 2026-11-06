import type { ReactElement } from 'react';

export function LoadingState(): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading application state"
      className="loading-container"
    >
      <div className="spinner" aria-hidden="true" />
      <p className="loading-text">Loading Affiliate Content OS...</p>
    </div>
  );
}
