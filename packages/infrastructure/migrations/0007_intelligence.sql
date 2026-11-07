-- 0007_intelligence.sql: AI policies, operations, AI runs, analyses, analysis subjects, job executions, and outbox events
-- Forward-only schema for intelligence vertical slice with composite tenant isolation, durable execution leases, and PostgreSQL-enforced analysis immutability.

CREATE TABLE workspace_ai_policies (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  monthly_budget_microunits BIGINT NOT NULL DEFAULT 0,
  current_spend_microunits BIGINT NOT NULL DEFAULT 0,
  reserved_spend_microunits BIGINT NOT NULL DEFAULT 0,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 10,
  budget_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  minute_window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  minute_request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT workspace_ai_policies_version_check CHECK (version >= 1),
  CONSTRAINT workspace_ai_policies_budget_check CHECK (monthly_budget_microunits >= 0),
  CONSTRAINT workspace_ai_policies_current_spend_check CHECK (current_spend_microunits >= 0),
  CONSTRAINT workspace_ai_policies_reserved_spend_check CHECK (reserved_spend_microunits >= 0),
  CONSTRAINT workspace_ai_policies_rate_limit_check CHECK (rate_limit_per_minute > 0),
  CONSTRAINT workspace_ai_policies_minute_request_count_check CHECK (minute_request_count >= 0)
);

-- Every pre-existing workspace receives a disabled, zero-budget policy. New
-- workspaces are provisioned in the workspace creation transaction.
INSERT INTO workspace_ai_policies (workspace_id, ai_enabled)
SELECT id, ai_enabled
FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

CREATE TABLE operations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  status TEXT NOT NULL,
  progress_percent INTEGER NULL,
  result_location TEXT NULL,
  error_category TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT operations_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT operations_workspace_product_fk FOREIGN KEY (workspace_id, resource_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT operations_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT operations_operation_type_check CHECK (operation_type IN ('product_analysis', 'niche_analysis')),
  CONSTRAINT operations_resource_type_check CHECK (resource_type = 'product'),
  CONSTRAINT operations_progress_check CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)),
  CONSTRAINT operations_version_check CHECK (version >= 1),
  CONSTRAINT operations_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT operations_error_category_check CHECK (
    error_category IS NULL OR error_category IN (
      'ai_disabled', 'budget_exhausted', 'rate_limited',
      'provider_unavailable', 'provider_timeout', 'invalid_output',
      'invalid_evidence', 'internal_error'
    )
  ),
  CONSTRAINT operations_result_location_check CHECK (result_location IS NULL OR (char_length(result_location) <= 2048 AND result_location !~ '[[:cntrl:]]')),
  CONSTRAINT operations_terminal_consistency_check CHECK (
    (status IN ('queued', 'running') AND completed_at IS NULL AND result_location IS NULL AND error_category IS NULL AND error_code IS NULL) OR
    (status = 'succeeded' AND completed_at IS NOT NULL AND completed_at >= created_at AND result_location IS NOT NULL AND error_category IS NULL AND error_code IS NULL) OR
    (status = 'failed' AND completed_at IS NOT NULL AND completed_at >= created_at AND error_category IS NOT NULL) OR
    (status = 'canceled' AND completed_at IS NOT NULL AND completed_at >= created_at)
  ),
  CONSTRAINT operations_timing_check CHECK (
    (started_at IS NULL OR started_at >= created_at) AND
    (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
  )
);

CREATE INDEX idx_operations_workspace_cursor ON operations (workspace_id, updated_at DESC, id DESC);
CREATE INDEX idx_operations_workspace_resource ON operations (workspace_id, resource_type, resource_id, updated_at DESC);

CREATE TABLE ai_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_schema_version INTEGER NOT NULL,
  output_schema_version INTEGER NOT NULL,
  input_hash BYTEA NOT NULL,
  output_hash BYTEA NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  is_repair BOOLEAN NOT NULL DEFAULT FALSE,
  token_input INTEGER NULL,
  token_output INTEGER NULL,
  cost_microunits BIGINT NULL,
  cost_currency TEXT NULL,
  latency_ms INTEGER NULL,
  safety_result TEXT NULL,
  error_category TEXT NULL,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT ai_runs_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT ai_runs_workspace_operation_fk FOREIGN KEY (workspace_id, operation_id) REFERENCES operations(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT ai_runs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT ai_runs_purpose_check CHECK (purpose IN ('product_analysis', 'niche_analysis')),
  CONSTRAINT ai_runs_provider_check CHECK (char_length(provider) BETWEEN 1 AND 128 AND provider = btrim(provider)),
  CONSTRAINT ai_runs_model_check CHECK (char_length(model) BETWEEN 1 AND 128 AND model = btrim(model)),
  CONSTRAINT ai_runs_prompt_template_check CHECK (char_length(prompt_template) BETWEEN 1 AND 128 AND prompt_template = btrim(prompt_template)),
  CONSTRAINT ai_runs_prompt_version_check CHECK (char_length(prompt_version) BETWEEN 1 AND 64 AND prompt_version = btrim(prompt_version)),
  CONSTRAINT ai_runs_input_hash_len CHECK (octet_length(input_hash) = 32),
  CONSTRAINT ai_runs_output_hash_len CHECK (output_hash IS NULL OR octet_length(output_hash) = 32),
  CONSTRAINT ai_runs_input_schema_version_check CHECK (input_schema_version >= 1),
  CONSTRAINT ai_runs_output_schema_version_check CHECK (output_schema_version >= 1),
  CONSTRAINT ai_runs_attempt_check CHECK (attempt >= 1),
  CONSTRAINT ai_runs_version_check CHECK (version >= 1),
  CONSTRAINT ai_runs_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT ai_runs_error_category_check CHECK (
    error_category IS NULL OR error_category IN (
      'ai_disabled', 'budget_exhausted', 'rate_limited',
      'provider_unavailable', 'provider_timeout', 'invalid_output',
      'invalid_evidence', 'internal_error'
    )
  ),
  CONSTRAINT ai_runs_terminal_consistency_check CHECK (
    (status IN ('queued', 'running') AND completed_at IS NULL AND output_hash IS NULL AND error_category IS NULL) OR
    (status = 'succeeded' AND completed_at IS NOT NULL AND completed_at >= created_at AND output_hash IS NOT NULL AND error_category IS NULL) OR
    (status = 'failed' AND completed_at IS NOT NULL AND completed_at >= created_at AND error_category IS NOT NULL) OR
    (status = 'canceled' AND completed_at IS NOT NULL AND completed_at >= created_at)
  ),
  CONSTRAINT ai_runs_timing_check CHECK (
    (started_at IS NULL OR started_at >= created_at) AND
    (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
  )
);

CREATE INDEX idx_ai_runs_workspace ON ai_runs (workspace_id, created_at DESC);
CREATE INDEX idx_ai_runs_operation ON ai_runs (operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE analyses (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  analysis_type TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  fact_set_id UUID NOT NULL,
  ai_run_id UUID NOT NULL,
  content_json JSONB NOT NULL,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  reviewed_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ NULL,
  review_reason TEXT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT analyses_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT analyses_workspace_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT analyses_workspace_fact_set_fk FOREIGN KEY (workspace_id, product_id, fact_set_id) REFERENCES product_fact_sets(workspace_id, product_id, id) ON DELETE RESTRICT,
  CONSTRAINT analyses_workspace_ai_run_fk FOREIGN KEY (workspace_id, ai_run_id) REFERENCES ai_runs(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT analyses_product_type_revision_unique UNIQUE (product_id, analysis_type, revision_number),
  CONSTRAINT analyses_status_check CHECK (status IN ('generated', 'accepted', 'rejected')),
  CONSTRAINT analyses_type_check CHECK (analysis_type IN ('product', 'niche', 'performance')),
  CONSTRAINT analyses_revision_number_check CHECK (revision_number >= 1),
  CONSTRAINT analyses_schema_version_check CHECK (schema_version >= 1),
  CONSTRAINT analyses_version_check CHECK (version >= 1),
  CONSTRAINT analyses_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT analyses_review_reason_check CHECK (review_reason IS NULL OR (char_length(review_reason) <= 2048 AND review_reason = btrim(review_reason))),
  CONSTRAINT analyses_review_consistency_check CHECK (
    (status = 'generated' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_reason IS NULL) OR
    (status IN ('accepted', 'rejected') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_at >= created_at)
  )
);

CREATE INDEX idx_analyses_product_type_rev ON analyses (product_id, analysis_type, revision_number DESC);
CREATE INDEX idx_analyses_workspace_cursor ON analyses (workspace_id, product_id, analysis_type, status, updated_at DESC, id DESC);

CREATE TABLE analysis_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  analysis_id UUID NOT NULL,
  subject_type TEXT NOT NULL,
  role TEXT NOT NULL,
  subject_product_id UUID NULL,
  subject_fact_set_id UUID NULL,
  subject_analysis_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT analysis_subjects_workspace_analysis_fk
    FOREIGN KEY (workspace_id, analysis_id) REFERENCES analyses(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT analysis_subjects_workspace_product_fk
    FOREIGN KEY (workspace_id, subject_product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT analysis_subjects_workspace_fact_set_fk
    FOREIGN KEY (workspace_id, subject_product_id, subject_fact_set_id) REFERENCES product_fact_sets(workspace_id, product_id, id) ON DELETE RESTRICT,
  CONSTRAINT analysis_subjects_workspace_source_analysis_fk
    FOREIGN KEY (workspace_id, subject_analysis_id) REFERENCES analyses(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT analysis_subjects_subject_type_check CHECK (subject_type IN ('product', 'fact_set', 'analysis')),
  CONSTRAINT analysis_subjects_role_check CHECK (role IN ('primary_subject', 'grounding_source', 'input_analysis')),
  CONSTRAINT analysis_subjects_typed_columns_check CHECK (
    (subject_type = 'product' AND subject_product_id IS NOT NULL AND subject_fact_set_id IS NULL AND subject_analysis_id IS NULL) OR
    (subject_type = 'fact_set' AND subject_product_id IS NOT NULL AND subject_fact_set_id IS NOT NULL AND subject_analysis_id IS NULL) OR
    (subject_type = 'analysis' AND subject_product_id IS NULL AND subject_fact_set_id IS NULL AND subject_analysis_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_analysis_subjects_product ON analysis_subjects (analysis_id, subject_type, role) WHERE subject_type = 'product';
CREATE UNIQUE INDEX uq_analysis_subjects_fact_set ON analysis_subjects (analysis_id, subject_type, role) WHERE subject_type = 'fact_set';
CREATE UNIQUE INDEX uq_analysis_subjects_analysis ON analysis_subjects (analysis_id, subject_type, role, subject_analysis_id) WHERE subject_type = 'analysis';
CREATE INDEX idx_analysis_subjects_workspace_subject ON analysis_subjects (workspace_id, subject_type, subject_product_id, subject_fact_set_id, subject_analysis_id);

CREATE OR REPLACE FUNCTION check_analysis_subject_product_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_product_id UUID;
  source_product_id UUID;
BEGIN
  IF NEW.subject_type = 'analysis' AND NEW.subject_analysis_id IS NOT NULL THEN
    SELECT product_id INTO target_product_id FROM analyses WHERE id = NEW.analysis_id;
    SELECT product_id INTO source_product_id FROM analyses WHERE id = NEW.subject_analysis_id;
    IF target_product_id IS DISTINCT FROM source_product_id THEN
      RAISE EXCEPTION 'source analysis product does not match target analysis product' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER analysis_subjects_check_product_match
BEFORE INSERT OR UPDATE ON analysis_subjects
FOR EACH ROW EXECUTE FUNCTION check_analysis_subject_product_match();

CREATE TABLE job_executions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL,
  ai_run_id UUID NOT NULL,
  job_type TEXT NOT NULL,
  deduplication_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  repair_attempt INTEGER NOT NULL DEFAULT 0,
  max_repair_attempts INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  last_error_category TEXT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id UUID NULL,
  reserved_spend_microunits BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT job_executions_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT job_executions_workspace_operation_fk FOREIGN KEY (workspace_id, operation_id) REFERENCES operations(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT job_executions_workspace_ai_run_fk FOREIGN KEY (workspace_id, ai_run_id) REFERENCES ai_runs(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT job_executions_workspace_type_dedup_unique UNIQUE (workspace_id, job_type, deduplication_key),
  CONSTRAINT job_executions_reserved_spend_check CHECK (reserved_spend_microunits >= 0),
  CONSTRAINT job_executions_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'retry_wait')),
  CONSTRAINT job_executions_attempt_check CHECK (attempt >= 0),
  CONSTRAINT job_executions_max_attempts_check CHECK (max_attempts >= 1),
  CONSTRAINT job_executions_repair_attempt_check CHECK (repair_attempt >= 0 AND repair_attempt <= max_repair_attempts),
  CONSTRAINT job_executions_max_repair_attempts_check CHECK (max_repair_attempts = 1),
  CONSTRAINT job_executions_version_check CHECK (version >= 1),
  CONSTRAINT job_executions_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT job_executions_payload_json_object_check CHECK (jsonb_typeof(payload_json) = 'object'),
  CONSTRAINT job_executions_timing_check CHECK (
    (started_at IS NULL OR started_at >= created_at) AND
    (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
  ),
  CONSTRAINT job_executions_lease_check CHECK (
    (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND started_at IS NOT NULL) OR
    (status IN ('queued', 'retry_wait', 'succeeded', 'failed') AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT job_executions_terminal_consistency_check CHECK (
    (status IN ('queued', 'running', 'retry_wait') AND completed_at IS NULL) OR
    (status = 'succeeded' AND completed_at IS NOT NULL AND completed_at >= created_at AND started_at IS NOT NULL AND last_error_category IS NULL) OR
    (status = 'failed' AND completed_at IS NOT NULL AND completed_at >= created_at AND started_at IS NOT NULL AND last_error_category IS NOT NULL)
  ),
  CONSTRAINT job_executions_error_category_check CHECK (
    last_error_category IS NULL OR last_error_category IN (
      'ai_disabled', 'budget_exhausted', 'rate_limited',
      'provider_unavailable', 'provider_timeout', 'invalid_output',
      'invalid_evidence', 'internal_error'
    )
  )
);

CREATE INDEX idx_job_executions_claim ON job_executions (status, next_attempt_at) WHERE status IN ('queued', 'retry_wait', 'running');
CREATE INDEX idx_job_executions_workspace ON job_executions (workspace_id, updated_at DESC);
CREATE INDEX idx_job_executions_op_run ON job_executions (workspace_id, operation_id, ai_run_id);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_version BIGINT NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ NOT NULL,
  delivery_count INTEGER NOT NULL DEFAULT 0,
  delivered_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT outbox_events_delivery_count_check CHECK (delivery_count >= 0),
  CONSTRAINT outbox_events_timestamp_check CHECK (created_at >= occurred_at),
  CONSTRAINT outbox_events_payload_json_object_check CHECK (jsonb_typeof(payload_json) = 'object'),
  CONSTRAINT outbox_events_event_type_check CHECK (length(event_type) <= 128 AND event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  CONSTRAINT outbox_events_aggregate_type_check CHECK (length(aggregate_type) <= 128 AND aggregate_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$')
);

CREATE INDEX idx_outbox_events_undelivered ON outbox_events (available_at, occurred_at) WHERE delivered_at IS NULL;
CREATE INDEX idx_outbox_events_workspace ON outbox_events (workspace_id, occurred_at DESC);

-- PostgreSQL-enforced analysis immutability trigger
CREATE OR REPLACE FUNCTION enforce_analysis_immutability() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'analyses cannot be deleted' USING ERRCODE = '55000';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Immutable structural fields must never change
    IF NEW.id <> OLD.id OR
       NEW.workspace_id <> OLD.workspace_id OR
       NEW.product_id <> OLD.product_id OR
       NEW.analysis_type <> OLD.analysis_type OR
       NEW.revision_number <> OLD.revision_number OR
       NEW.fact_set_id <> OLD.fact_set_id OR
       NEW.ai_run_id <> OLD.ai_run_id OR
       NEW.content_json <> OLD.content_json OR
       NEW.schema_version <> OLD.schema_version OR
       NEW.created_by_user_id <> OLD.created_by_user_id OR
       NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'analysis content and structural metadata are immutable' USING ERRCODE = '55000';
    END IF;

    -- If previously accepted or rejected, status cannot be mutated further
    IF OLD.status IN ('accepted', 'rejected') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'reviewed analyses are final and cannot be modified' USING ERRCODE = '55000';
    END IF;

    -- Valid transition from generated to accepted or rejected
    IF OLD.status = 'generated' AND NEW.status IN ('accepted', 'rejected') THEN
      IF NEW.reviewed_by_user_id IS NULL OR NEW.reviewed_at IS NULL THEN
        RAISE EXCEPTION 'reviewed_by_user_id and reviewed_at required for review decision' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END IF;

    -- Idempotent update of same status
    IF OLD.status = NEW.status THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid analysis status transition from % to %', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER analyses_enforce_immutability
BEFORE UPDATE OR DELETE ON analyses
FOR EACH ROW EXECUTE FUNCTION enforce_analysis_immutability();
