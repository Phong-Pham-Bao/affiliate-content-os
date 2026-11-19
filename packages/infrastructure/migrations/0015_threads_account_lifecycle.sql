-- 0015_threads_account_lifecycle.sql: Threads Account Lifecycle & Reconnect/Refresh/Disconnect
-- Forward-only schema extension for staged exchange, reconnect identity binding,
-- credential refresh leasing/metadata, account-health status reasons, and external revocation facts.

-- 1. Extend social_accounts
ALTER TABLE social_accounts
  ADD COLUMN status_reason TEXT NULL,
  ADD COLUMN exchange_stage TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN reauth_required_at TIMESTAMPTZ NULL,
  ADD COLUMN last_refreshed_at TIMESTAMPTZ NULL,
  ADD COLUMN next_refresh_at TIMESTAMPTZ NULL,
  ADD COLUMN refresh_lease_claimed_at TIMESTAMPTZ NULL,
  ADD COLUMN refresh_lease_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN refresh_lease_worker_id TEXT NULL,
  ADD COLUMN refresh_consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN external_revocation_attempted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN external_revocation_supported BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN external_revocation_result TEXT NULL,
  ADD COLUMN disconnected_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_status_reason_check CHECK (
    status_reason IS NULL OR status_reason IN (
      'none', 'initial_exchange_complete', 'transient_failure', 'token_expired',
      'grant_revoked', 'refresh_expired', 'rate_limited', 'review_pending',
      'kill_switched', 'reauth_required', 'disconnected_by_user', 'reconnect_required'
    )
  ),
  ADD CONSTRAINT social_accounts_exchange_stage_check CHECK (
    exchange_stage IN ('code_received', 'short_token_exchanged', 'long_token_exchanged', 'profile_inspected', 'completed')
  ),
  ADD CONSTRAINT social_accounts_external_revocation_check CHECK (
    external_revocation_result IS NULL OR external_revocation_result IN ('succeeded', 'failed', 'unsupported')
  ),
  ADD CONSTRAINT social_accounts_refresh_failures_check CHECK (
    refresh_consecutive_failures >= 0
  );

CREATE INDEX idx_social_accounts_due_refresh
  ON social_accounts (next_refresh_at)
  WHERE status IN ('active', 'degraded') AND next_refresh_at IS NOT NULL;

CREATE INDEX idx_social_accounts_stale_refresh_lease
  ON social_accounts (refresh_lease_expires_at)
  WHERE refresh_lease_expires_at IS NOT NULL;

-- 2. Extend oauth_transactions for reconnect and staged exchange
ALTER TABLE oauth_transactions
  ADD COLUMN reconnect_account_id UUID NULL,
  ADD COLUMN expected_provider_account_id TEXT NULL,
  ADD COLUMN exchange_stage TEXT NOT NULL DEFAULT 'code_received';

ALTER TABLE oauth_transactions
  ADD CONSTRAINT fk_oauth_transactions_reconnect_account
    FOREIGN KEY (workspace_id, reconnect_account_id)
    REFERENCES social_accounts(workspace_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT oauth_transactions_exchange_stage_check CHECK (
    exchange_stage IN ('code_received', 'short_token_exchanged', 'long_token_exchanged', 'profile_inspected', 'completed')
  ),
  ADD CONSTRAINT oauth_transactions_expected_provider_account_id_check CHECK (
    expected_provider_account_id IS NULL OR (
      char_length(expected_provider_account_id) BETWEEN 1 AND 255 AND
      expected_provider_account_id = btrim(expected_provider_account_id) AND
      expected_provider_account_id !~ '[[:cntrl:]]'
    )
  );

CREATE INDEX idx_oauth_transactions_reconnect
  ON oauth_transactions (workspace_id, reconnect_account_id)
  WHERE reconnect_account_id IS NOT NULL;

-- 3. Extend social_credentials for token kind and refresh tracking
ALTER TABLE social_credentials
  ADD COLUMN token_kind TEXT NOT NULL DEFAULT 'long_lived',
  ADD COLUMN issued_at TIMESTAMPTZ NULL,
  ADD COLUMN last_refreshed_at TIMESTAMPTZ NULL,
  ADD COLUMN refresh_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN earliest_refresh_at TIMESTAMPTZ NULL;

ALTER TABLE social_credentials
  ADD CONSTRAINT social_credentials_token_kind_check CHECK (
    token_kind IN ('short_lived', 'long_lived')
  ),
  ADD CONSTRAINT social_credentials_refresh_attempts_check CHECK (
    refresh_attempt_count >= 0
  );

-- 4. Extend oauth_callback_results error codes for account mismatch & outcome unknown
ALTER TABLE oauth_callback_results
  DROP CONSTRAINT oauth_callback_results_error_code_check;

ALTER TABLE oauth_callback_results
  ADD CONSTRAINT oauth_callback_results_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'access_denied', 'exchange_failed', 'provider_error', 'provider_timeout',
      'account_mismatch', 'outcome_unknown'
    )
  );
