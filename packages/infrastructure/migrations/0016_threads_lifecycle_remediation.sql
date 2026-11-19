-- 0016_threads_lifecycle_remediation.sql: Threads lifecycle concurrency, claim fencing, and callback truth remediation
-- Forward-only schema extension for exclusive refresh claim tokens, truthful partial callback results,
-- capability freshness/status reasons, and due-work index support.

-- 1. Extend social_accounts for exclusive refresh claim fencing and status reasons
ALTER TABLE social_accounts
  ADD COLUMN refresh_lease_token TEXT NULL;

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_refresh_lease_token_check CHECK (
    refresh_lease_token IS NULL OR (
      char_length(refresh_lease_token) BETWEEN 16 AND 128 AND
      refresh_lease_token = btrim(refresh_lease_token) AND
      refresh_lease_token !~ '[[:cntrl:]]'
    )
  );

ALTER TABLE social_accounts
  DROP CONSTRAINT social_accounts_status_reason_check;

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_status_reason_check CHECK (
    status_reason IS NULL OR status_reason IN (
      'none', 'initial_exchange_complete', 'transient_failure', 'token_expired',
      'grant_revoked', 'refresh_expired', 'rate_limited', 'review_pending',
      'kill_switched', 'reauth_required', 'disconnected_by_user', 'reconnect_required',
      'capability_stale', 'missing_grants'
    )
  );

CREATE INDEX idx_social_accounts_due_refresh_claim
  ON social_accounts (workspace_id, next_refresh_at, refresh_lease_expires_at)
  WHERE status IN ('active', 'degraded');

-- 2. Extend oauth_callback_results for truthful partial callback results
ALTER TABLE oauth_callback_results
  DROP CONSTRAINT oauth_callback_results_status_check;

ALTER TABLE oauth_callback_results
  ADD CONSTRAINT oauth_callback_results_status_check CHECK (
    status IN ('success', 'failed', 'partial')
  );

ALTER TABLE oauth_callback_results
  DROP CONSTRAINT oauth_callback_results_error_code_check;

ALTER TABLE oauth_callback_results
  ADD CONSTRAINT oauth_callback_results_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'access_denied', 'exchange_failed', 'provider_error', 'provider_timeout',
      'account_mismatch', 'outcome_unknown', 'partial_exchange'
    )
  );

ALTER TABLE oauth_callback_results
  DROP CONSTRAINT oauth_callback_results_outcome_check;

ALTER TABLE oauth_callback_results
  ADD CONSTRAINT oauth_callback_results_outcome_check CHECK (
    (status = 'success' AND social_account_id IS NOT NULL AND error_code IS NULL AND error_description IS NULL) OR
    (status = 'partial' AND social_account_id IS NOT NULL AND error_code IS NOT NULL) OR
    (status = 'failed' AND error_code IS NOT NULL)
  );
