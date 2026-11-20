-- 0019_threads_final_fencing.sql: Enforce active-job uniqueness, revocation phase/status combinations,
-- terminal secret wiping, lease/timestamp consistency, and bounded attempt constraints.
-- Forward-only schema hardening closing remaining side-effect and stale-lease gaps.

-- 1. Unique active revocation job per social account
-- Prevents repeated/concurrent disconnect from creating multiple active provider revocations.
CREATE UNIQUE INDEX idx_social_account_revocations_active
  ON social_account_revocations (social_account_id)
  WHERE status IN ('pending', 'in_progress');

-- 2. Revocation phase and status combination consistency
ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_phase_status_check
    CHECK (
      (phase = 'terminal' AND status IN ('succeeded', 'failed')) OR
      (phase IN ('claimed', 'provider_attempt_started') AND status IN ('pending', 'in_progress'))
    );

-- 3. Terminal completion timestamp consistency
ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_completed_at_check
    CHECK (
      (phase = 'terminal' AND completed_at IS NOT NULL) OR
      (phase <> 'terminal' AND completed_at IS NULL)
    );

-- 4. Active lease consistency: in_progress jobs must possess worker, lease token, and lease expiry
ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_active_lease_check
    CHECK (
      (status = 'in_progress' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL) OR
      (status <> 'in_progress')
    );

-- 5. Timestamp ordering consistency
ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_timestamps_order
    CHECK (
      (lease_expires_at IS NULL OR lease_expires_at >= created_at) AND
      updated_at >= created_at AND
      (completed_at IS NULL OR completed_at >= created_at)
    );

-- 6. Bounded nonnegative attempt count
ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_attempt_count_check
    CHECK (attempt_count >= 0 AND attempt_count <= 100);

-- 7. Platform and encryption key version bounds
ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_platform_check
    CHECK (platform IN ('threads', 'tiktok'));

ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_key_version_check
    CHECK (char_length(encryption_key_version) BETWEEN 1 AND 32 AND encryption_key_version = btrim(encryption_key_version));

-- 8. Safe worker and lease token bounds
ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_worker_id_check
    CHECK (
      worker_id IS NULL OR
      (char_length(worker_id) BETWEEN 1 AND 128 AND worker_id = btrim(worker_id) AND worker_id !~ '[[:cntrl:]]')
    );

ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_lease_token_check
    CHECK (
      lease_token IS NULL OR
      (char_length(lease_token) BETWEEN 1 AND 64 AND lease_token = btrim(lease_token) AND lease_token !~ '[[:cntrl:]]')
    );

-- 9. Terminal secret wiping consistency: terminal jobs must have empty token material
ALTER TABLE social_account_revocations
  ADD CONSTRAINT social_account_revocations_secret_wipe_check
    CHECK (
      (phase = 'terminal' AND octet_length(encrypted_token) = 0) OR
      (phase <> 'terminal' AND octet_length(encrypted_token) > 0)
    );