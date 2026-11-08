-- 0009_workforce_planning_execution.sql: Sprint 3 Checkpoint B workforce planning execution
-- Forward-only schema adding workforce planning linkages, content artifacts,
-- immutable artifact revisions, and artifact evidence references.

-- 1. Ensure agent_assignments has composite unique key for foreign key references
ALTER TABLE agent_assignments
  ADD CONSTRAINT agent_assignments_ws_order_id_unique UNIQUE (workspace_id, work_order_id, id);

-- 2. Linkage columns and constraints on operations
ALTER TABLE operations
  ADD COLUMN work_order_id UUID NULL,
  ADD COLUMN work_item_id UUID NULL;

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
      'workforce_planning'
    )
  );

ALTER TABLE operations
  ADD CONSTRAINT operations_workforce_work_item_fk
    FOREIGN KEY (workspace_id, work_order_id, work_item_id)
    REFERENCES work_items(workspace_id, work_order_id, id)
    ON DELETE RESTRICT;

ALTER TABLE operations
  ADD CONSTRAINT operations_workforce_linkage_check CHECK (
    (work_order_id IS NULL AND work_item_id IS NULL) OR
    (work_order_id IS NOT NULL AND work_item_id IS NOT NULL)
  );

ALTER TABLE work_orders
  DROP CONSTRAINT work_orders_mission_type_check;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_mission_type_check CHECK (
    mission_type IN (
      'single_product_affiliate_launch',
      'short_video_series',
      'product_launch_plan',
      'objection_handling_series',
      'educational_series',
      'custom'
    )
  );

CREATE INDEX idx_operations_workforce_item
  ON operations (workspace_id, work_order_id, work_item_id)
  WHERE work_order_id IS NOT NULL;

-- 3. Linkage columns and constraints on ai_runs
ALTER TABLE ai_runs
  ADD COLUMN work_order_id UUID NULL,
  ADD COLUMN work_item_id UUID NULL;

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
      'workforce_planning'
    )
  );

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_workforce_work_item_fk
    FOREIGN KEY (workspace_id, work_order_id, work_item_id)
    REFERENCES work_items(workspace_id, work_order_id, id)
    ON DELETE RESTRICT;

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_workforce_linkage_check CHECK (
    (work_order_id IS NULL AND work_item_id IS NULL) OR
    (work_order_id IS NOT NULL AND work_item_id IS NOT NULL)
  );

CREATE INDEX idx_ai_runs_workforce_item
  ON ai_runs (workspace_id, work_order_id, work_item_id)
  WHERE work_order_id IS NOT NULL;

-- 4. Linkage columns and constraints on job_executions
ALTER TABLE job_executions
  ADD COLUMN work_order_id UUID NULL,
  ADD COLUMN work_item_id UUID NULL;

ALTER TABLE job_executions
  ADD CONSTRAINT job_executions_workforce_work_item_fk
    FOREIGN KEY (workspace_id, work_order_id, work_item_id)
    REFERENCES work_items(workspace_id, work_order_id, id)
    ON DELETE RESTRICT;

ALTER TABLE job_executions
  ADD CONSTRAINT job_executions_workforce_linkage_check CHECK (
    (work_order_id IS NULL AND work_item_id IS NULL) OR
    (work_order_id IS NOT NULL AND work_item_id IS NOT NULL)
  );

CREATE INDEX idx_job_executions_workforce_item
  ON job_executions (workspace_id, work_order_id, work_item_id)
  WHERE work_order_id IS NOT NULL;

-- 5. Content artifacts table
CREATE TABLE content_artifacts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  author_role_key TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  current_revision_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT content_artifacts_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT content_artifacts_artifact_rev_unique UNIQUE (id, current_revision_number),
  CONSTRAINT content_artifacts_workspace_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_artifacts_workspace_work_order_fk FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_artifacts_workspace_work_item_fk FOREIGN KEY (workspace_id, work_order_id, work_item_id) REFERENCES work_items(workspace_id, work_order_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_artifacts_workspace_assignment_fk FOREIGN KEY (workspace_id, work_order_id, assignment_id) REFERENCES agent_assignments(workspace_id, work_order_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_artifacts_author_role_key_check CHECK (
    author_role_key IN (
      'chief_of_staff',
      'product_strategist',
      'audience_strategist',
      'creative_director',
      'scriptwriter',
      'compliance_reviewer'
    )
  ),
  CONSTRAINT content_artifacts_artifact_type_check CHECK (
    artifact_type IN (
      'product_campaign_plan',
      'audience_insight_board',
      'video_series_plan',
      'script_package',
      'compliance_report',
      'work_plan',
      'executive_summary'
    )
  ),
  CONSTRAINT content_artifacts_lifecycle_status_check CHECK (
    lifecycle_status IN (
      'draft',
      'review_required',
      'accepted',
      'rejected',
      'superseded'
    )
  ),
  CONSTRAINT content_artifacts_revision_num_check CHECK (current_revision_number >= 1),
  CONSTRAINT content_artifacts_version_check CHECK (version >= 1),
  CONSTRAINT content_artifacts_updated_at_check CHECK (updated_at >= created_at)
);

CREATE INDEX idx_content_artifacts_order ON content_artifacts (workspace_id, work_order_id, created_at DESC);
CREATE INDEX idx_content_artifacts_product ON content_artifacts (workspace_id, product_id, artifact_type, created_at DESC);
CREATE INDEX idx_content_artifacts_item ON content_artifacts (workspace_id, work_item_id);

-- 6. Content artifact revisions table (immutable)
CREATE TABLE content_artifact_revisions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  artifact_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  content_json JSONB NOT NULL,
  content_hash BYTEA NOT NULL,
  schema_version INTEGER NOT NULL,
  prompt_template TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  token_input INTEGER NULL,
  token_output INTEGER NULL,
  cost_microunits BIGINT NULL,
  cost_currency TEXT NULL,
  latency_ms INTEGER NULL,
  author_role_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT content_artifact_revisions_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT content_artifact_revisions_artifact_rev_unique UNIQUE (artifact_id, revision_number),
  CONSTRAINT content_artifact_revisions_ws_artifact_rev_unique UNIQUE (workspace_id, artifact_id, revision_number),
  CONSTRAINT content_artifact_revisions_artifact_fk FOREIGN KEY (workspace_id, artifact_id) REFERENCES content_artifacts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_artifact_revisions_hash_len CHECK (octet_length(content_hash) = 32),
  CONSTRAINT content_artifact_revisions_rev_num_check CHECK (revision_number >= 1),
  CONSTRAINT content_artifact_revisions_schema_ver_check CHECK (schema_version >= 1),
  CONSTRAINT content_artifact_revisions_json_obj_check CHECK (jsonb_typeof(content_json) = 'object'),
  CONSTRAINT content_artifact_revisions_author_role_check CHECK (
    author_role_key IN (
      'chief_of_staff',
      'product_strategist',
      'audience_strategist',
      'creative_director',
      'scriptwriter',
      'compliance_reviewer'
    )
  )
);

CREATE INDEX idx_content_artifact_revisions_artifact ON content_artifact_revisions (artifact_id, revision_number DESC);
CREATE INDEX idx_content_artifact_revisions_workspace ON content_artifact_revisions (workspace_id, created_at DESC);

-- 7. Artifact evidence references table (immutable)
CREATE TABLE artifact_evidence_refs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  artifact_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  source_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT artifact_evidence_refs_unique UNIQUE (artifact_id, revision_number, source_kind, source_id),
  CONSTRAINT artifact_evidence_refs_rev_fk FOREIGN KEY (workspace_id, artifact_id, revision_number) REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number) ON DELETE RESTRICT,
  CONSTRAINT artifact_evidence_refs_source_kind_check CHECK (source_kind IN ('product_fact', 'analysis'))
);

CREATE INDEX idx_artifact_evidence_refs_artifact ON artifact_evidence_refs (artifact_id, revision_number);
CREATE INDEX idx_artifact_evidence_refs_source ON artifact_evidence_refs (workspace_id, source_kind, source_id);

-- 8. Immutability triggers
CREATE OR REPLACE FUNCTION enforce_content_artifact_revision_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content_artifact_revisions rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER content_artifact_revisions_enforce_immutability
BEFORE UPDATE OR DELETE ON content_artifact_revisions
FOR EACH ROW EXECUTE FUNCTION enforce_content_artifact_revision_immutability();

CREATE OR REPLACE FUNCTION enforce_artifact_evidence_ref_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'artifact_evidence_refs rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER artifact_evidence_refs_enforce_immutability
BEFORE UPDATE OR DELETE ON artifact_evidence_refs
FOR EACH ROW EXECUTE FUNCTION enforce_artifact_evidence_ref_immutability();
