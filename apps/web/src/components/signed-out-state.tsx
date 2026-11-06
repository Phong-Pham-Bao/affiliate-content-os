import type { ReactElement } from 'react';

export function SignedOutState(): ReactElement {
  return (
    <main className="landing-card" aria-labelledby="landing-heading">
      <header className="landing-header">
        <h1 id="landing-heading" className="landing-title">
          Affiliate Content OS
        </h1>
        <p className="landing-subtitle">
          Content-commerce automation platform. High-standard affiliate publishing with rigorous
          human approvals, durable audit history, and multi-tenant isolation.
        </p>
      </header>

      <div className="landing-actions">
        <a href="/auth/login" className="btn-primary sign-in-btn" aria-label="Sign in with Google">
          <span className="google-icon" aria-hidden="true">
            G
          </span>
          <span>Sign in with Google</span>
        </a>
      </div>

      <footer className="landing-footer">
        <p className="legal-notice">
          By signing in, you access workspaces governed by role-based capabilities and audit
          policies.
        </p>
      </footer>
    </main>
  );
}
