-- 0021_durable_publication_core.sql: Sprint 4 Checkpoint C durable scheduling and publication core
-- Forward-only schema adding publication approval snapshots, publications, attempts,
-- lineage constraints, immutability triggers, and claim/query indexes.

-- 1. Publication approval snapshots table (immutable)
CREATE TABLE publication_approval_snapshots (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  content_approval_id UUID NOT NULL,
  content_approval_snapshot_hash BYTEA NOT NULL,
  artifact_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  content_hash BYTEA NOT NULL,
  platform TEXT NOT NULL,
  social_account_id UUID NOT NULL,
  provider_account_id TEXT NOT NULL,
  account_version BIGINT NOT NULL,
  capability_fingerprint BYTEA NOT NULL,
  capabilities_snapshot_json JSONB NOT NULL,
  capabilities_checked_at TIMESTAMPTZ NOT NULL,
  rendered_text TEXT NOT NULL,
  preview_hash BYTEA NOT NULL,
  disclosure_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  platform_settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consent_type TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_hash BYTEA NOT NULL,
  snapshot_json JSONB NOT NULL,
  snapshot_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT publication_approval_snapshots_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT fk_publication_approval_snapshots_content_approval
    FOREIGN KEY (workspace_id, content_approval_id)
    REFERENCES content_approval_snapshots(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_publication_approval_snapshots_social_account
    FOREIGN KEY (workspace_id, social_account_id)
    REFERENCES social_accounts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_publication_approval_snapshots_artifact_revision
    FOREIGN KEY (workspace_id, artifact_id, revision_number, content_hash)
    REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number, content_hash) ON DELETE RESTRICT,
  CONSTRAINT publication_approval_snapshots_platform_check CHECK (platform IN ('threads', 'tiktok')),
  CONSTRAINT publication_approval_snapshots_consent_type_check CHECK (consent_type = 'human_publisher'),
  CONSTRAINT publication_approval_snapshots_content_approval_hash_len CHECK (octet_length(content_approval_snapshot_hash) = 32),
  CONSTRAINT publication_approval_snapshots_content_hash_len CHECK (octet_length(content_hash) = 32),
  CONSTRAINT publication_approval_snapshots_capability_fp_len CHECK (octet_length(capability_fingerprint) = 32),
  CONSTRAINT publication_approval_snapshots_preview_hash_len CHECK (octet_length(preview_hash) = 32),
  CONSTRAINT publication_approval_snapshots_policy_hash_len CHECK (octet_length(policy_hash) = 32),
  CONSTRAINT publication_approval_snapshots_snapshot_hash_len CHECK (octet_length(snapshot_hash) = 32),
  CONSTRAINT publication_approval_snapshots_rendered_text_len CHECK (char_length(rendered_text) BETWEEN 1 AND 500),
  CONSTRAINT publication_approval_snapshots_caps_json_check CHECK (jsonb_typeof(capabilities_snapshot_json) = 'object'),
  CONSTRAINT publication_approval_snapshots_disclosure_json_check CHECK (jsonb_typeof(disclosure_state_json) = 'object'),
  CONSTRAINT publication_approval_snapshots_settings_json_check CHECK (jsonb_typeof(platform_settings_json) = 'object'),
  CONSTRAINT publication_approval_snapshots_snapshot_json_check CHECK (jsonb_typeof(snapshot_json) = 'object')
);

CREATE INDEX idx_publication_approval_snapshots_ws
  ON publication_approval_snapshots (workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_publication_approval_snapshots_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'publication_approval_snapshots rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER publication_approval_snapshots_enforce_immutability
BEFORE UPDATE OR DELETE ON publication_approval_snapshots
FOR EACH ROW EXECUTE FUNCTION enforce_publication_approval_snapshots_immutability();

-- 2. Publications table
CREATE TABLE publications (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  approval_snapshot_id UUID NOT NULL,
  social_account_id UUID NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_at_utc TIMESTAMPTZ NOT NULL,
  original_local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  lease_token UUID NULL,
  lease_owner TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  current_attempt_number INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  remote_post_id TEXT NULL,
  remote_permalink TEXT NULL,
  published_at TIMESTAMPTZ NULL,
  last_error_code TEXT NULL,
  last_error_message TEXT NULL,
  gated_reason TEXT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT publications_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT publications_workspace_approval_unique UNIQUE (workspace_id, approval_snapshot_id),
  CONSTRAINT fk_publications_approval_snapshot
    FOREIGN KEY (workspace_id, approval_snapshot_id)
    REFERENCES publication_approval_snapshots(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_publications_social_account
    FOREIGN KEY (workspace_id, social_account_id)
    REFERENCES social_accounts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT publications_platform_check CHECK (platform IN ('threads', 'tiktok')),
  CONSTRAINT publications_status_check CHECK (
    status IN (
      'scheduled', 'queued', 'publishing', 'processing_remote',
      'published', 'retry_wait', 'outcome_unknown', 'failed', 'rejected', 'canceled'
    )
  ),
  CONSTRAINT publications_attempts_check CHECK (
    current_attempt_number >= 0 AND current_attempt_number <= max_attempts
  ),
  CONSTRAINT publications_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 20),
  CONSTRAINT publications_version_check CHECK (version >= 1),
  CONSTRAINT publications_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT publications_lease_check CHECK (
    (status IN ('publishing', 'queued') AND lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (status NOT IN ('publishing', 'queued') AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT publications_terminal_check CHECK (
    (status IN ('scheduled', 'queued', 'publishing', 'processing_remote', 'retry_wait') AND completed_at IS NULL) OR
    (status = 'published' AND completed_at IS NOT NULL AND remote_post_id IS NOT NULL AND char_length(remote_post_id) >= 1) OR
    (status IN ('failed', 'rejected', 'canceled', 'outcome_unknown') AND completed_at IS NOT NULL)
  ),
  CONSTRAINT publications_published_check CHECK (
    (status = 'published' AND published_at IS NOT NULL AND remote_post_id IS NOT NULL) OR
    (status <> 'published' AND published_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_publications_confirmed_remote_post
  ON publications (social_account_id, remote_post_id)
  WHERE status = 'published' AND remote_post_id IS NOT NULL;

CREATE INDEX idx_publications_claim
  ON publications (status, scheduled_at_utc, next_attempt_at)
  WHERE status IN ('scheduled', 'retry_wait');

CREATE INDEX idx_publications_lease_expiry
  ON publications (lease_expires_at)
  WHERE status IN ('queued', 'publishing') AND lease_expires_at IS NOT NULL;

CREATE INDEX idx_publications_workspace_list
  ON publications (workspace_id, created_at DESC, id DESC);

CREATE INDEX idx_publications_workspace_status
  ON publications (workspace_id, status, scheduled_at_utc ASC);

CREATE OR REPLACE FUNCTION enforce_publications_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'publications cannot be deleted' USING ERRCODE = '55000';
  END IF;

  -- Structural lineage fields are immutable
  IF NEW.id <> OLD.id OR
     NEW.workspace_id <> OLD.workspace_id OR
     NEW.approval_snapshot_id <> OLD.approval_snapshot_id OR
     NEW.social_account_id <> OLD.social_account_id OR
     NEW.platform <> OLD.platform OR
     NEW.created_by_user_id <> OLD.created_by_user_id OR
     NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'publication structural fields are immutable' USING ERRCODE = '55000';
  END IF;

  -- Terminal statuses cannot regress or mutate
  IF OLD.status IN ('published', 'failed', 'rejected', 'canceled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'terminal publications cannot be mutated' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER publications_enforce_lifecycle
BEFORE UPDATE OR DELETE ON publications
FOR EACH ROW EXECUTE FUNCTION enforce_publications_lifecycle();

-- 3. Publication attempts table
CREATE TABLE publication_attempts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  publication_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  attempt_idempotency_key TEXT NOT NULL,
  request_hash BYTEA NOT NULL,
  adapter_version TEXT NOT NULL,
  correlation_id UUID NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  outcome_code TEXT NULL,
  outcome_message TEXT NULL,
  remote_post_id TEXT NULL,
  remote_permalink TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT publication_attempts_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT publication_attempts_pub_attempt_unique UNIQUE (workspace_id, publication_id, attempt_number),
  CONSTRAINT publication_attempts_idemp_key_unique UNIQUE (workspace_id, attempt_idempotency_key),
  CONSTRAINT fk_publication_attempts_publication
    FOREIGN KEY (workspace_id, publication_id)
    REFERENCES publications(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT publication_attempts_attempt_number_check CHECK (attempt_number >= 1),
  CONSTRAINT publication_attempts_request_hash_len CHECK (octet_length(request_hash) = 32),
  CONSTRAINT publication_attempts_phase_check CHECK (
    phase IN ('prepared', 'provider_attempt_started', 'terminal')
  ),
  CONSTRAINT publication_attempts_status_check CHECK (
    status IN ('running', 'succeeded', 'transient_failure', 'permanent_failure', 'outcome_unknown')
  ),
  CONSTRAINT publication_attempts_version_check CHECK (version >= 1),
  CONSTRAINT publication_attempts_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT publication_attempts_phase_status_check CHECK (
    (phase IN ('prepared', 'provider_attempt_started') AND status = 'running' AND completed_at IS NULL) OR
    (phase = 'terminal' AND status IN ('succeeded', 'transient_failure', 'permanent_failure', 'outcome_unknown') AND completed_at IS NOT NULL AND completed_at >= started_at)
  ),
  CONSTRAINT publication_attempts_succeeded_check CHECK (
    (status = 'succeeded' AND remote_post_id IS NOT NULL AND char_length(remote_post_id) >= 1) OR
    (status <> 'succeeded' AND remote_post_id IS NULL)
  ),
  CONSTRAINT publication_attempts_failure_outcome_check CHECK (
    (status IN ('transient_failure', 'permanent_failure', 'outcome_unknown') AND outcome_code IS NOT NULL) OR
    (status NOT IN ('transient_failure', 'permanent_failure', 'outcome_unknown') AND outcome_code IS NULL)
  )
);

CREATE INDEX idx_publication_attempts_pub
  ON publication_attempts (workspace_id, publication_id, attempt_number DESC);

CREATE OR REPLACE FUNCTION enforce_publication_attempts_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'publication_attempts cannot be deleted' USING ERRCODE = '55000';
  END IF;

  -- Structural fields are immutable
  IF NEW.id <> OLD.id OR
     NEW.workspace_id <> OLD.workspace_id OR
     NEW.publication_id <> OLD.publication_id OR
     NEW.attempt_number <> OLD.attempt_number OR
     NEW.attempt_idempotency_key <> OLD.attempt_idempotency_key OR
     NEW.request_hash <> OLD.request_hash OR
     NEW.adapter_version <> OLD.adapter_version OR
     NEW.correlation_id <> OLD.correlation_id OR
     NEW.started_at <> OLD.started_at OR
     NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'publication_attempts structural fields are immutable' USING ERRCODE = '55000';
  END IF;

  -- Terminal attempts cannot be modified
  IF OLD.phase = 'terminal' AND (NEW.phase <> OLD.phase OR NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'terminal publication_attempts cannot be mutated' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_attempts_enforce_lifecycle
BEFORE UPDATE OR DELETE ON publication_attempts
FOR EACH ROW EXECUTE FUNCTION enforce_publication_attempts_lifecycle();
