-- 0014_social_connections_foundation.sql: Social Connections Foundation
-- Forward-only schema for social accounts, isolated credentials, OAuth transactions, and opaque callback results.

CREATE TABLE social_accounts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  handle TEXT NULL,
  status TEXT NOT NULL,
  granted_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  capabilities_checked_at TIMESTAMPTZ NULL,
  token_expires_at TIMESTAMPTZ NULL,
  connected_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  disconnected_at TIMESTAMPTZ NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT social_accounts_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT social_accounts_platform_check CHECK (platform IN ('threads', 'tiktok')),
  CONSTRAINT social_accounts_status_check CHECK (status IN ('connecting', 'active', 'degraded', 'reauth_required', 'review_gated', 'disconnected')),
  CONSTRAINT social_accounts_environment_check CHECK (environment IN ('production', 'test', 'local')),
  CONSTRAINT social_accounts_provider_account_id_check CHECK (char_length(provider_account_id) BETWEEN 1 AND 255 AND provider_account_id = btrim(provider_account_id) AND provider_account_id !~ '[[:cntrl:]]'),
  CONSTRAINT social_accounts_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 255 AND display_name = btrim(display_name) AND display_name !~ '[[:cntrl:]]'),
  CONSTRAINT social_accounts_handle_check CHECK (handle IS NULL OR (char_length(handle) BETWEEN 1 AND 255 AND handle = btrim(handle) AND handle !~ '[[:cntrl:]]')),
  CONSTRAINT social_accounts_granted_scopes_check CHECK (jsonb_typeof(granted_scopes) = 'array'),
  CONSTRAINT social_accounts_capabilities_check CHECK (jsonb_typeof(capabilities_json) = 'object'),
  CONSTRAINT social_accounts_version_check CHECK (version >= 1),
  CONSTRAINT social_accounts_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT social_accounts_lifecycle_check CHECK (
    (status = 'disconnected' AND disconnected_at IS NOT NULL AND disconnected_at >= created_at) OR
    (status <> 'disconnected' AND disconnected_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_social_accounts_active ON social_accounts (workspace_id, platform, provider_account_id) WHERE status <> 'disconnected';
CREATE INDEX idx_social_accounts_workspace_status ON social_accounts (workspace_id, status, updated_at DESC);

CREATE TABLE social_credentials (
  social_account_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  access_token_ciphertext BYTEA NOT NULL,
  access_token_iv BYTEA NOT NULL,
  access_token_auth_tag BYTEA NOT NULL,
  refresh_token_ciphertext BYTEA NULL,
  refresh_token_iv BYTEA NULL,
  refresh_token_auth_tag BYTEA NULL,
  encryption_key_version TEXT NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'bearer',
  access_expires_at TIMESTAMPTZ NULL,
  refresh_expires_at TIMESTAMPTZ NULL,
  scope_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  rotated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT fk_social_credentials_account FOREIGN KEY (workspace_id, social_account_id) REFERENCES social_accounts(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT social_credentials_workspace_account_unique UNIQUE (workspace_id, social_account_id),
  CONSTRAINT social_credentials_key_version_check CHECK (encryption_key_version ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT social_credentials_token_type_check CHECK (token_type IN ('bearer', 'mac')),
  CONSTRAINT social_credentials_access_token_len CHECK (
    octet_length(access_token_ciphertext) > 0 AND
    octet_length(access_token_iv) = 12 AND
    octet_length(access_token_auth_tag) = 16
  ),
  CONSTRAINT social_credentials_refresh_token_check CHECK (
    (refresh_token_ciphertext IS NULL AND refresh_token_iv IS NULL AND refresh_token_auth_tag IS NULL) OR
    (
      refresh_token_ciphertext IS NOT NULL AND octet_length(refresh_token_ciphertext) > 0 AND
      refresh_token_iv IS NOT NULL AND octet_length(refresh_token_iv) = 12 AND
      refresh_token_auth_tag IS NOT NULL AND octet_length(refresh_token_auth_tag) = 16
    )
  ),
  CONSTRAINT social_credentials_scopes_check CHECK (jsonb_typeof(scope_snapshot) = 'array'),
  CONSTRAINT social_credentials_version_check CHECK (version >= 1),
  CONSTRAINT social_credentials_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT social_credentials_rotated_at_check CHECK (rotated_at >= created_at)
);

CREATE TABLE oauth_transactions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL,
  initiated_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state_hash BYTEA NOT NULL UNIQUE,
  pkce_verifier_ciphertext BYTEA NULL,
  pkce_verifier_iv BYTEA NULL,
  pkce_verifier_auth_tag BYTEA NULL,
  encryption_key_version TEXT NULL,
  redirect_uri TEXT NOT NULL,
  return_to TEXT NOT NULL,
  requested_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NULL,
  claimed_expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT oauth_transactions_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT oauth_transactions_state_hash_len CHECK (octet_length(state_hash) = 32),
  CONSTRAINT oauth_transactions_platform_check CHECK (platform IN ('threads', 'tiktok')),
  CONSTRAINT oauth_transactions_status_check CHECK (status IN ('pending', 'claimed', 'consumed', 'expired', 'failed')),
  CONSTRAINT oauth_transactions_redirect_uri_check CHECK (char_length(redirect_uri) BETWEEN 1 AND 2048 AND redirect_uri = btrim(redirect_uri) AND redirect_uri !~ '[[:cntrl:]]'),
  CONSTRAINT oauth_transactions_return_to_check CHECK (
    char_length(return_to) BETWEEN 1 AND 2048 AND
    return_to = btrim(return_to) AND
    return_to LIKE '/%' AND
    return_to NOT LIKE '//%'
  ),
  CONSTRAINT oauth_transactions_requested_scopes_check CHECK (jsonb_typeof(requested_scopes) = 'array'),
  CONSTRAINT oauth_transactions_expires_at_check CHECK (expires_at > created_at),
  CONSTRAINT oauth_transactions_version_check CHECK (version >= 1),
  CONSTRAINT oauth_transactions_pkce_consistency_check CHECK (
    (pkce_verifier_ciphertext IS NULL AND pkce_verifier_iv IS NULL AND pkce_verifier_auth_tag IS NULL AND encryption_key_version IS NULL) OR
    (
      pkce_verifier_ciphertext IS NOT NULL AND
      pkce_verifier_iv IS NOT NULL AND octet_length(pkce_verifier_iv) = 12 AND
      pkce_verifier_auth_tag IS NOT NULL AND octet_length(pkce_verifier_auth_tag) = 16 AND
      encryption_key_version IS NOT NULL AND encryption_key_version ~ '^[A-Za-z0-9._-]{1,64}$'
    )
  ),
  CONSTRAINT oauth_transactions_lifecycle_check CHECK (
    (status = 'pending' AND claimed_at IS NULL AND claimed_expires_at IS NULL AND consumed_at IS NULL) OR
    (status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at >= created_at AND claimed_expires_at IS NOT NULL AND claimed_expires_at > claimed_at AND consumed_at IS NULL) OR
    (status IN ('consumed', 'failed', 'expired') AND consumed_at IS NOT NULL AND consumed_at >= created_at)
  )
);

CREATE INDEX idx_oauth_transactions_pending_lookup ON oauth_transactions (state_hash) WHERE status = 'pending';
CREATE INDEX idx_oauth_transactions_expires ON oauth_transactions (expires_at) WHERE status = 'pending';
CREATE INDEX idx_oauth_transactions_workspace ON oauth_transactions (workspace_id, initiated_by_user_id, status);

CREATE TABLE oauth_callback_results (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL,
  initiated_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  result_key_hash BYTEA NOT NULL UNIQUE,
  status TEXT NOT NULL,
  platform TEXT NOT NULL,
  social_account_id UUID NULL,
  error_code TEXT NULL,
  error_description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT fk_oauth_callback_results_transaction FOREIGN KEY (workspace_id, transaction_id) REFERENCES oauth_transactions(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_oauth_callback_results_account FOREIGN KEY (workspace_id, social_account_id) REFERENCES social_accounts(workspace_id, id) ON DELETE SET NULL,
  CONSTRAINT uq_oauth_callback_results_transaction UNIQUE (workspace_id, transaction_id),
  CONSTRAINT oauth_callback_results_result_key_hash_len CHECK (octet_length(result_key_hash) = 32),
  CONSTRAINT oauth_callback_results_status_check CHECK (status IN ('success', 'failed')),
  CONSTRAINT oauth_callback_results_platform_check CHECK (platform IN ('threads', 'tiktok')),
  CONSTRAINT oauth_callback_results_error_code_check CHECK (error_code IS NULL OR error_code IN ('access_denied', 'exchange_failed', 'provider_error', 'provider_timeout')),
  CONSTRAINT oauth_callback_results_error_description_check CHECK (error_description IS NULL OR (char_length(error_description) BETWEEN 1 AND 256 AND error_description = btrim(error_description) AND error_description !~ '[[:cntrl:]]')),
  CONSTRAINT oauth_callback_results_outcome_check CHECK (
    (status = 'success' AND social_account_id IS NOT NULL AND error_code IS NULL AND error_description IS NULL) OR
    (status = 'failed' AND error_code IS NOT NULL AND error_description IS NOT NULL)
  ),
  CONSTRAINT oauth_callback_results_expires_at_check CHECK (expires_at > created_at),
  CONSTRAINT oauth_callback_results_consumed_at_check CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT oauth_callback_results_version_check CHECK (version >= 1)
);

CREATE INDEX idx_oauth_callback_results_lookup ON oauth_callback_results (workspace_id, initiated_by_user_id, result_key_hash);
CREATE INDEX idx_oauth_callback_results_expires ON oauth_callback_results (expires_at);
