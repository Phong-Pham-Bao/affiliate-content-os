-- 0010_content_studio_revisions.sql: Sprint 3 Checkpoint C content studio, script units, and immutable revisions
-- Forward-only schema adding script-generation units, content briefs, change requests,
-- and immutable revision lineage.

-- 1. Extend operations and ai_runs check constraints to allow 'scriptwriting'
ALTER TABLE operations
  DROP CONSTRAINT operations_operation_type_check;

ALTER TABLE operations
  ADD CONSTRAINT operations_operation_type_check CHECK (
    operation_type IN (
      'product_analysis',
      'niche_analysis',
      'product_strategy',
      'audience_strategy',
      'creative_direction',
      'workforce_planning',
      'scriptwriting'
    )
  );

ALTER TABLE ai_runs
  DROP CONSTRAINT ai_runs_purpose_check;

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_purpose_check CHECK (
    purpose IN (
      'product_analysis',
      'niche_analysis',
      'product_strategy',
      'audience_strategy',
      'creative_direction',
      'workforce_planning',
      'scriptwriting'
    )
  );

-- 2. Content briefs table (immutable)
CREATE TABLE content_briefs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  brief_version INTEGER NOT NULL DEFAULT 1,
  brief_hash BYTEA NOT NULL,
  brief_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT content_briefs_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT content_briefs_ws_order_version_unique UNIQUE (workspace_id, work_order_id, brief_version),
  CONSTRAINT content_briefs_workspace_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_briefs_workspace_work_order_fk FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_briefs_hash_len CHECK (octet_length(brief_hash) = 32),
  CONSTRAINT content_briefs_version_check CHECK (brief_version >= 1),
  CONSTRAINT content_briefs_json_obj_check CHECK (jsonb_typeof(brief_json) = 'object')
);

CREATE INDEX idx_content_briefs_order ON content_briefs (workspace_id, work_order_id, brief_version DESC);
CREATE INDEX idx_content_briefs_hash ON content_briefs (workspace_id, brief_hash);

-- Enforce immutability of content_briefs
CREATE OR REPLACE FUNCTION enforce_content_brief_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content_briefs rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER content_briefs_enforce_immutability
BEFORE UPDATE OR DELETE ON content_briefs
FOR EACH ROW EXECUTE FUNCTION enforce_content_brief_immutability();

-- 3. Artifact change requests table
CREATE TABLE artifact_change_requests (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  artifact_id UUID NOT NULL,
  base_revision_number INTEGER NOT NULL,
  base_content_hash BYTEA NOT NULL,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  instruction_text TEXT NOT NULL,
  selected_video_numbers JSONB NOT NULL,
  target_variant_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  resulting_revision_number INTEGER NULL,
  failure_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT artifact_change_requests_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT artifact_change_requests_ws_artifact_fk FOREIGN KEY (workspace_id, artifact_id) REFERENCES content_artifacts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT artifact_change_requests_ws_base_rev_fk FOREIGN KEY (workspace_id, artifact_id, base_revision_number) REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number) ON DELETE RESTRICT,
  CONSTRAINT artifact_change_requests_hash_len CHECK (octet_length(base_content_hash) = 32),
  CONSTRAINT artifact_change_requests_instruction_check CHECK (
    char_length(instruction_text) BETWEEN 1 AND 2000 AND
    instruction_text = btrim(instruction_text) AND
    instruction_text !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'
  ),
  CONSTRAINT artifact_change_requests_status_check CHECK (
    status IN ('pending', 'in_progress', 'completed', 'failed', 'canceled')
  ),
  CONSTRAINT artifact_change_requests_videos_array CHECK (jsonb_typeof(selected_video_numbers) = 'array'),
  CONSTRAINT artifact_change_requests_variants_check CHECK (target_variant_count BETWEEN 1 AND 3),
  CONSTRAINT artifact_change_requests_version_check CHECK (version >= 1),
  CONSTRAINT artifact_change_requests_updated_at_check CHECK (updated_at >= created_at)
);

CREATE INDEX idx_artifact_change_requests_artifact ON artifact_change_requests (workspace_id, artifact_id, created_at DESC);
CREATE INDEX idx_artifact_change_requests_status ON artifact_change_requests (workspace_id, status);

-- 4. Script generation units table
CREATE TABLE script_generation_units (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  video_number INTEGER NOT NULL,
  target_variant_count INTEGER NOT NULL DEFAULT 1,
  change_request_id UUID NULL,
  status TEXT NOT NULL,
  operation_id UUID NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
  ai_run_id UUID NOT NULL REFERENCES ai_runs(id) ON DELETE RESTRICT,
  job_id UUID NOT NULL REFERENCES job_executions(id) ON DELETE RESTRICT,
  brief_hash BYTEA NOT NULL,
  output_json JSONB NULL,
  content_hash BYTEA NULL,
  error_category TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT script_generation_units_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT script_generation_units_ws_work_item_fk FOREIGN KEY (workspace_id, work_order_id, work_item_id) REFERENCES work_items(workspace_id, work_order_id, id) ON DELETE RESTRICT,
  CONSTRAINT script_generation_units_ws_change_req_fk FOREIGN KEY (workspace_id, change_request_id) REFERENCES artifact_change_requests(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT script_generation_units_video_num_check CHECK (video_number BETWEEN 1 AND 5),
  CONSTRAINT script_generation_units_status_check CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'retry_wait')
  ),
  CONSTRAINT script_generation_units_brief_hash_len CHECK (octet_length(brief_hash) = 32),
  CONSTRAINT script_generation_units_hash_len CHECK (content_hash IS NULL OR octet_length(content_hash) = 32),
  CONSTRAINT script_generation_units_variants_check CHECK (target_variant_count BETWEEN 1 AND 3),
  CONSTRAINT script_generation_units_version_check CHECK (version >= 1),
  CONSTRAINT script_generation_units_updated_at_check CHECK (updated_at >= created_at)
);

CREATE INDEX idx_script_gen_units_order_video ON script_generation_units (workspace_id, work_order_id, video_number);
CREATE INDEX idx_script_gen_units_change_req ON script_generation_units (workspace_id, change_request_id) WHERE change_request_id IS NOT NULL;
CREATE INDEX idx_script_gen_units_job ON script_generation_units (workspace_id, job_id);

-- 5. Content artifact lineage table (immutable)
CREATE TABLE content_artifact_lineage (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  artifact_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  parent_revision_number INTEGER NULL,
  lineage_type TEXT NOT NULL,
  change_request_id UUID NULL,
  content_brief_hash BYTEA NOT NULL,
  content_brief_version INTEGER NOT NULL DEFAULT 1,
  planning_revision_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_script_unit_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT content_artifact_lineage_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT content_artifact_lineage_art_rev_unique UNIQUE (artifact_id, revision_number),
  CONSTRAINT content_artifact_lineage_ws_rev_fk FOREIGN KEY (workspace_id, artifact_id, revision_number) REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number) ON DELETE RESTRICT,
  CONSTRAINT content_artifact_lineage_ws_parent_rev_fk FOREIGN KEY (workspace_id, artifact_id, parent_revision_number) REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number) ON DELETE RESTRICT,
  CONSTRAINT content_artifact_lineage_ws_change_req_fk FOREIGN KEY (workspace_id, change_request_id) REFERENCES artifact_change_requests(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_artifact_lineage_type_check CHECK (
    lineage_type IN ('ai_generated', 'human_edited', 'change_request')
  ),
  CONSTRAINT content_artifact_lineage_brief_hash_len CHECK (octet_length(content_brief_hash) = 32),
  CONSTRAINT content_artifact_lineage_brief_version_check CHECK (content_brief_version >= 1),
  CONSTRAINT content_artifact_lineage_planning_json_check CHECK (jsonb_typeof(planning_revision_ids_json) = 'object'),
  CONSTRAINT content_artifact_lineage_unit_ids_json_check CHECK (jsonb_typeof(source_script_unit_ids_json) = 'array'),
  CONSTRAINT content_artifact_lineage_meta_json_check CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX idx_content_artifact_lineage_artifact ON content_artifact_lineage (workspace_id, artifact_id, revision_number DESC);
CREATE INDEX idx_content_artifact_lineage_parent ON content_artifact_lineage (workspace_id, artifact_id, parent_revision_number);
CREATE INDEX idx_content_artifact_lineage_brief_hash ON content_artifact_lineage (workspace_id, content_brief_hash);

-- Enforce immutability of content_artifact_lineage
CREATE OR REPLACE FUNCTION enforce_content_artifact_lineage_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content_artifact_lineage rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER content_artifact_lineage_enforce_immutability
BEFORE UPDATE OR DELETE ON content_artifact_lineage
FOR EACH ROW EXECUTE FUNCTION enforce_content_artifact_lineage_immutability();
