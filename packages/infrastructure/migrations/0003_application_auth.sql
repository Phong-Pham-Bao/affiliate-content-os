CREATE TABLE oidc_login_transactions (
  id UUID PRIMARY KEY,
  state_hash BYTEA NOT NULL UNIQUE,
  browser_binding_hash BYTEA NOT NULL,
  secrets_ciphertext BYTEA NULL,
  secrets_iv BYTEA NULL,
  secrets_auth_tag BYTEA NULL,
  key_version TEXT NOT NULL,
  return_to TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT oidc_login_transactions_state_hash_len_check CHECK (octet_length(state_hash) = 32),
  CONSTRAINT oidc_login_transactions_browser_binding_hash_len_check CHECK (octet_length(browser_binding_hash) = 32),
  CONSTRAINT oidc_login_transactions_status_check CHECK (status IN ('pending', 'consumed')),
  CONSTRAINT oidc_login_transactions_key_version_format_check CHECK (key_version ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT oidc_login_transactions_return_to_check CHECK (
    length(return_to) <= 2048 AND
    return_to LIKE '/%' AND
    return_to NOT LIKE '//%'
  ),
  CONSTRAINT oidc_login_transactions_expires_at_check CHECK (expires_at > created_at),
  CONSTRAINT oidc_login_transactions_version_check CHECK (version >= 1),
  CONSTRAINT oidc_login_transactions_lifecycle_check CHECK (
    (
      status = 'pending' AND
      consumed_at IS NULL AND
      secrets_ciphertext IS NOT NULL AND
      secrets_iv IS NOT NULL AND octet_length(secrets_iv) = 12 AND
      secrets_auth_tag IS NOT NULL AND octet_length(secrets_auth_tag) = 16
    ) OR (
      status = 'consumed' AND
      consumed_at IS NOT NULL AND
      consumed_at >= created_at AND
      secrets_ciphertext IS NULL AND
      secrets_iv IS NULL AND
      secrets_auth_tag IS NULL
    )
  )
);

CREATE INDEX idx_oidc_login_transactions_status_expires ON oidc_login_transactions (status, expires_at);
CREATE INDEX idx_oidc_login_transactions_lookup ON oidc_login_transactions (state_hash, browser_binding_hash);

CREATE TABLE application_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  current_token_hash BYTEA NULL,
  previous_token_hash BYTEA NULL,
  previous_token_valid_until TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  revocation_reason TEXT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT application_sessions_version_check CHECK (version >= 1),
  CONSTRAINT application_sessions_revocation_reason_check CHECK (
    revocation_reason IS NULL OR
    revocation_reason IN ('logout', 'user_unavailable', 'idle_expired', 'absolute_expired')
  ),
  CONSTRAINT application_sessions_timestamps_order_check CHECK (
    last_seen_at >= created_at AND
    rotated_at >= created_at AND
    last_seen_at >= rotated_at AND
    idle_expires_at >= last_seen_at AND
    absolute_expires_at > created_at AND
    idle_expires_at <= absolute_expires_at
  ),
  CONSTRAINT application_sessions_lifecycle_check CHECK (
    (
      revoked_at IS NULL AND
      revocation_reason IS NULL AND
      current_token_hash IS NOT NULL AND
      octet_length(current_token_hash) = 32 AND
      (
        (previous_token_hash IS NULL AND previous_token_valid_until IS NULL) OR
        (
          previous_token_hash IS NOT NULL AND
          octet_length(previous_token_hash) = 32 AND
          previous_token_valid_until IS NOT NULL AND
          previous_token_valid_until >= rotated_at AND
          previous_token_valid_until <= absolute_expires_at AND
          previous_token_hash <> current_token_hash
        )
      )
    ) OR (
      revoked_at IS NOT NULL AND
      revocation_reason IS NOT NULL AND
      revoked_at >= created_at AND
      current_token_hash IS NULL AND
      previous_token_hash IS NULL AND
      previous_token_valid_until IS NULL
    )
  )
);

CREATE UNIQUE INDEX idx_application_sessions_current_token_hash
  ON application_sessions (current_token_hash)
  WHERE current_token_hash IS NOT NULL;

CREATE UNIQUE INDEX idx_application_sessions_previous_token_hash
  ON application_sessions (previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;

CREATE INDEX idx_application_sessions_user_id
  ON application_sessions (user_id);

CREATE INDEX idx_application_sessions_active_expiry
  ON application_sessions (revoked_at, idle_expires_at, absolute_expires_at);
