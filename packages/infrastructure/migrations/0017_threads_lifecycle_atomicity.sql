-- 0017_threads_lifecycle_atomicity.sql: Threads lifecycle operation atomicity, idempotency fencing, and staged revocation
-- Forward-only schema extension for durable social account operations, fenced lifecycle mutations, and truthful revocation state.

-- 1. Extend social_accounts external_revocation_result to support staged 'pending' state
ALTER TABLE social_accounts
  DROP CONSTRAINT social_accounts_external_revocation_check;

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_external_revocation_check CHECK (
    external_revocation_result IS NULL OR external_revocation_result IN (
      'pending', 'succeeded', 'failed', 'unsupported'
    )
  );

-- 2. Extend social_accounts status_reason to include identity_mismatch
ALTER TABLE social_accounts
  DROP CONSTRAINT social_accounts_status_reason_check;

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_status_reason_check CHECK (
    status_reason IS NULL OR status_reason IN (
      'none', 'initial_exchange_complete', 'transient_failure', 'token_expired',
      'grant_revoked', 'refresh_expired', 'rate_limited', 'review_pending',
      'kill_switched', 'reauth_required', 'disconnected_by_user', 'reconnect_required',
      'capability_stale', 'missing_grants', 'identity_mismatch'
    )
  );

-- 3. Create social_account_operations table for durable state machine and fenced idempotency
CREATE TABLE social_account_operations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  route_key TEXT NOT NULL,
  key_hash BYTEA NOT NULL,
  request_hash BYTEA NOT NULL,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  resource_version INTEGER NULL,
  status_code INTEGER NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  response_json JSONB NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT social_account_operations_operation_type_check CHECK (
    operation_type IN ('refresh', 'disconnect')
  ),
  CONSTRAINT social_account_operations_status_check CHECK (
    status IN ('pending', 'completed', 'failed')
  ),
  CONSTRAINT social_account_operations_key_hash_len CHECK (octet_length(key_hash) = 32),
  CONSTRAINT social_account_operations_request_hash_len CHECK (octet_length(request_hash) = 32),
  CONSTRAINT social_account_operations_route_key_check CHECK (
    length(route_key) <= 256 AND route_key = btrim(route_key) AND route_key !~ '[[:cntrl:]]'
  ),
  CONSTRAINT social_account_operations_lease_token_check CHECK (
    char_length(lease_token) BETWEEN 16 AND 128 AND
    lease_token = btrim(lease_token) AND
    lease_token !~ '[[:cntrl:]]'
  ),
  CONSTRAINT social_account_operations_status_code_check CHECK (
    status_code IS NULL OR (status_code >= 100 AND status_code <= 599)
  ),
  CONSTRAINT social_account_operations_response_json_check CHECK (
    response_json IS NULL OR jsonb_typeof(response_json) = 'object'
  ),
  CONSTRAINT social_account_operations_timestamp_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX idx_social_account_operations_idempotency
  ON social_account_operations (workspace_id, principal_id, route_key, key_hash);

CREATE INDEX idx_social_account_operations_account
  ON social_account_operations (workspace_id, social_account_id);

CREATE INDEX idx_social_account_operations_expires
  ON social_account_operations (expires_at);
