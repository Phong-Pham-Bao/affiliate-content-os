import type { ReactElement } from 'react';

interface AuthUnavailableProps {
  readonly message: string;
  readonly onRetry: () => void;
}

export function AuthUnavailableState({ message, onRetry }: AuthUnavailableProps): ReactElement {
  return (
    <main className="landing-card" role="alert" aria-labelledby="auth-unavailable-heading">
      <header className="landing-header">
        <h1 id="auth-unavailable-heading" className="landing-title error-title">
          Authentication Unavailable
        </h1>
        <p className="landing-subtitle">
          {message ||
            'The authentication service is temporarily unavailable or not yet configured.'}
        </p>
      </header>

      <div className="landing-actions">
        <button
          type="button"
          onClick={onRetry}
          className="btn-primary"
          aria-label="Retry authentication check"
        >
          Retry Connection
        </button>
      </div>
    </main>
  );
}
