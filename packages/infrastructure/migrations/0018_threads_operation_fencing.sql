-- 0018_threads_operation_fencing.sql: Enforce composite tenant integrity, operation phases, safe error diagnostics, and durable asynchronous revocation
-- Forward-only migration closing lifecycle fencing and provider outcome uncertainty gaps.

-- 1. Structural tenant integrity for social_account_operations: composite foreign key to social_accounts
ALTER TABLE social_account_operations
  DROP CONSTRAINT social_account_operations_social_account_id_fkey;

ALTER TABLE social_account_operations
  ADD CONSTRAINT social_account_operations_tenant_account_fkey
    FOREIGN KEY (workspace_id, social_account_id)
    REFERENCES social_accounts(workspace_id, id) ON DELETE CASCADE;

-- 2. Durable operation phases to represent provider outcome uncertainty
ALTER TABLE social_account_operations
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'claimed';

ALTER TABLE social_account_operations
  ADD CONSTRAINT social_account_operations_phase_check
    CHECK (phase IN ('claimed', 'provider_attempt_started', 'terminal'));

ALTER TABLE social_account_operations
  ADD CONSTRAINT social_account_operations_phase_status_check
    CHECK (
      (phase IN ('claimed', 'provider_attempt_started') AND status = 'pending') OR
      (phase = 'terminal' AND status IN ('completed', 'failed'))
    );

-- 3. Diagnostic safety and consistency constraints for social_account_operations
ALTER TABLE social_account_operations
  ADD CONSTRAINT social_account_operations_error_consistency
    CHECK (
      (status = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL) OR
      (status <> 'failed' AND error_code IS NULL AND error_message IS NULL)
    );

ALTER TABLE social_account_operations
  ADD CONSTRAINT social_account_operations_error_code_check
    CHECK (
      error_code IS NULL OR
      (char_length(error_code) BETWEEN 1 AND 64 AND error_code = btrim(error_code) AND error_code !~ '[[:cntrl:]]')
    );

ALTER TABLE social_account_operations
  ADD CONSTRAINT social_account_operations_error_message_check
    CHECK (
      error_message IS NULL OR
      (char_length(error_message) BETWEEN 1 AND 256 AND error_message = btrim(error_message) AND error_message !~ '[[:cntrl:]]')
    );

ALTER TABLE social_account_operations
  ADD CONSTRAINT social_account_operations_lease_expires_check
    CHECK (lease_expires_at >= created_at);

CREATE INDEX idx_social_account_operations_pending
  ON social_account_operations (status, phase, lease_expires_at)
  WHERE status = 'pending';

-- 4. Durable asynchronous revocation table with composite tenant relationship and encrypted token handoff
CREATE TABLE social_account_revocations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL,
  platform TEXT NOT NULL,
  encrypted_token BYTEA NOT NULL,
  token_iv BYTEA NOT NULL,
  token_auth_tag BYTEA NOT NULL,
  encryption_key_version TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'claimed',
  lease_token TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  worker_id TEXT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT social_account_revocations_tenant_account_fkey
    FOREIGN KEY (workspace_id, social_account_id)
    REFERENCES social_accounts(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT social_account_revocations_status_check
    CHECK (status IN ('pending', 'in_progress', 'succeeded', 'failed')),
  CONSTRAINT social_account_revocations_phase_check
    CHECK (phase IN ('claimed', 'provider_attempt_started', 'terminal')),
  CONSTRAINT social_account_revocations_token_iv_len
    CHECK (octet_length(token_iv) = 12),
  CONSTRAINT social_account_revocations_token_auth_tag_len
    CHECK (octet_length(token_auth_tag) = 16),
  CONSTRAINT social_account_revocations_error_code_check
    CHECK (
      error_code IS NULL OR
      (char_length(error_code) BETWEEN 1 AND 64 AND error_code = btrim(error_code) AND error_code !~ '[[:cntrl:]]')
    ),
  CONSTRAINT social_account_revocations_error_message_check
    CHECK (
      error_message IS NULL OR
      (char_length(error_message) BETWEEN 1 AND 256 AND error_message = btrim(error_message) AND error_message !~ '[[:cntrl:]]')
    ),
  CONSTRAINT social_account_revocations_error_consistency
    CHECK (
      (status = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL) OR
      (status <> 'failed' AND error_code IS NULL AND error_message IS NULL)
    )
);

CREATE INDEX idx_social_account_revocations_due
  ON social_account_revocations (status, phase, lease_expires_at, created_at)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX idx_social_account_revocations_account
  ON social_account_revocations (workspace_id, social_account_id);
