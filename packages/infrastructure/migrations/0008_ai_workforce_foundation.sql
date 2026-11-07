-- 0008_ai_workforce_foundation.sql: AI workforce orchestration foundation
-- Forward-only schema for deterministic work-order graphs, immutable context snapshots,
-- role definitions, parallel work items, dependency wait states, and assignment projections.

CREATE TABLE agent_role_definitions (
  id UUID PRIMARY KEY,
  role_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  department TEXT NOT NULL,
  role_version INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_artifact_types_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT agent_role_definitions_key_version_unique UNIQUE (role_key, role_version),
  CONSTRAINT agent_role_definitions_role_key_check CHECK (
    role_key IN (
      'chief_of_staff',
      'product_strategist',
      'audience_strategist',
      'creative_director',
      'scriptwriter',
      'compliance_reviewer'
    )
  ),
  CONSTRAINT agent_role_definitions_display_name_check CHECK (
    char_length(display_name) BETWEEN 1 AND 128 AND
    display_name = btrim(display_name) AND
    display_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT agent_role_definitions_department_check CHECK (
    char_length(department) BETWEEN 1 AND 128 AND
    department = btrim(department) AND
    department !~ '[[:cntrl:]]'
  ),
  CONSTRAINT agent_role_definitions_role_version_check CHECK (role_version >= 1),
  CONSTRAINT agent_role_definitions_artifacts_array_check CHECK (jsonb_typeof(allowed_artifact_types_json) = 'array'),
  CONSTRAINT agent_role_definitions_version_check CHECK (version >= 1),
  CONSTRAINT agent_role_definitions_updated_at_check CHECK (updated_at >= created_at)
);

-- Seed exactly the six approved role definitions at role version 1
INSERT INTO agent_role_definitions (
  id, role_key, display_name, department, role_version, is_active,
  allowed_artifact_types_json, created_at, updated_at, version
) VALUES
  ('018f0000-0000-7000-8000-000000000001', 'chief_of_staff', 'Chief of Staff', 'Strategy room', 1, TRUE, '["work_plan", "executive_summary"]'::jsonb, NOW(), NOW(), 1),
  ('018f0000-0000-7000-8000-000000000002', 'product_strategist', 'Product Strategist', 'Product desk', 1, TRUE, '["product_campaign_plan"]'::jsonb, NOW(), NOW(), 1),
  ('018f0000-0000-7000-8000-000000000003', 'audience_strategist', 'Audience Strategist', 'Insight desk', 1, TRUE, '["audience_insight_board"]'::jsonb, NOW(), NOW(), 1),
  ('018f0000-0000-7000-8000-000000000004', 'creative_director', 'Creative Director', 'Creative studio', 1, TRUE, '["video_series_plan", "video_idea"]'::jsonb, NOW(), NOW(), 1),
  ('018f0000-0000-7000-8000-000000000005', 'scriptwriter', 'Scriptwriter', 'Content desk', 1, TRUE, '["script_package", "script", "shot_list", "caption_variant"]'::jsonb, NOW(), NOW(), 1),
  ('018f0000-0000-7000-8000-000000000006', 'compliance_reviewer', 'Compliance Reviewer', 'Quality lab', 1, TRUE, '["compliance_report"]'::jsonb, NOW(), NOW(), 1)
ON CONFLICT (role_key, role_version) DO NOTHING;

CREATE TABLE context_packages (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  fact_set_id UUID NOT NULL,
  context_schema_version INTEGER NOT NULL,
  context_hash BYTEA NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT context_packages_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT context_packages_workspace_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_packages_workspace_fact_set_fk FOREIGN KEY (workspace_id, product_id, fact_set_id) REFERENCES product_fact_sets(workspace_id, product_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_packages_hash_len CHECK (octet_length(context_hash) = 32),
  CONSTRAINT context_packages_schema_version_check CHECK (context_schema_version >= 1)
);

CREATE INDEX idx_context_packages_workspace_product ON context_packages (workspace_id, product_id, created_at DESC);

-- Context packages are immutable
CREATE OR REPLACE FUNCTION enforce_context_package_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'context_packages rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER context_packages_enforce_immutability
BEFORE UPDATE OR DELETE ON context_packages
FOR EACH ROW EXECUTE FUNCTION enforce_context_package_immutability();

CREATE TABLE context_package_analyses (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  context_package_id UUID NOT NULL,
  analysis_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (context_package_id, analysis_id),
  CONSTRAINT context_package_analyses_pkg_fk FOREIGN KEY (workspace_id, context_package_id) REFERENCES context_packages(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_package_analyses_analysis_fk FOREIGN KEY (workspace_id, analysis_id) REFERENCES analyses(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_context_pkg_analyses_ws ON context_package_analyses (workspace_id, context_package_id);

CREATE TRIGGER context_package_analyses_enforce_immutability
BEFORE UPDATE OR DELETE ON context_package_analyses
FOR EACH ROW EXECUTE FUNCTION enforce_context_package_immutability();

CREATE TABLE work_orders (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  context_package_id UUID NOT NULL,
  mission_type TEXT NOT NULL,
  directive_text TEXT NOT NULL,
  graph_template TEXT NOT NULL,
  graph_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  failure_category TEXT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT work_orders_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT work_orders_workspace_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_orders_workspace_context_package_fk FOREIGN KEY (workspace_id, context_package_id) REFERENCES context_packages(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_orders_mission_type_check CHECK (
    mission_type IN (
      'short_video_series',
      'product_launch_plan',
      'objection_handling_series',
      'educational_series',
      'custom'
    )
  ),
  CONSTRAINT work_orders_directive_check CHECK (
    char_length(directive_text) BETWEEN 1 AND 4000 AND
    directive_text = btrim(directive_text) AND
    directive_text !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'
  ),
  CONSTRAINT work_orders_template_check CHECK (graph_template = 'creative_office_v1'),
  CONSTRAINT work_orders_graph_version_check CHECK (graph_version = 1),
  CONSTRAINT work_orders_status_check CHECK (
    status IN (
      'preparing',
      'in_progress',
      'waiting_review',
      'completed',
      'blocked',
      'failed',
      'canceled'
    )
  ),
  CONSTRAINT work_orders_priority_check CHECK (priority BETWEEN 1 AND 100),
  CONSTRAINT work_orders_version_check CHECK (version >= 1),
  CONSTRAINT work_orders_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT work_orders_failure_category_check CHECK (
    failure_category IS NULL OR (
      char_length(failure_category) BETWEEN 1 AND 128 AND
      failure_category = btrim(failure_category)
    )
  ),
  CONSTRAINT work_orders_terminal_consistency_check CHECK (
    (status IN ('preparing', 'in_progress', 'waiting_review') AND completed_at IS NULL AND failure_category IS NULL) OR
    (status = 'completed' AND completed_at IS NOT NULL AND completed_at >= created_at AND failure_category IS NULL) OR
    (status = 'failed' AND completed_at IS NOT NULL AND completed_at >= created_at AND failure_category IS NOT NULL) OR
    (status = 'canceled' AND completed_at IS NOT NULL AND completed_at >= created_at) OR
    (status = 'blocked' AND completed_at IS NULL)
  )
);

CREATE INDEX idx_work_orders_workspace_cursor ON work_orders (workspace_id, updated_at DESC, id DESC);
CREATE INDEX idx_work_orders_workspace_product ON work_orders (workspace_id, product_id, status, updated_at DESC);

CREATE TABLE work_items (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  role_definition_id UUID NOT NULL REFERENCES agent_role_definitions(id) ON DELETE RESTRICT,
  task_key TEXT NOT NULL,
  expected_artifact_type TEXT NOT NULL,
  status TEXT NOT NULL,
  blocked_reason_code TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT work_items_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT work_items_work_order_id_task_key_unique UNIQUE (work_order_id, task_key),
  CONSTRAINT work_items_ws_order_id_unique UNIQUE (workspace_id, work_order_id, id),
  CONSTRAINT work_items_workspace_work_order_fk FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_items_task_key_check CHECK (
    task_key IN (
      'product_strategy',
      'audience_strategy',
      'creative_direction',
      'scriptwriting',
      'compliance_review'
    )
  ),
  CONSTRAINT work_items_artifact_type_check CHECK (
    expected_artifact_type IN (
      'product_campaign_plan',
      'audience_insight_board',
      'video_series_plan',
      'script_package',
      'compliance_report'
    )
  ),
  CONSTRAINT work_items_status_check CHECK (
    status IN (
      'ready',
      'waiting_dependency',
      'queued',
      'running',
      'review_required',
      'completed',
      'blocked',
      'failed',
      'canceled'
    )
  ),
  CONSTRAINT work_items_version_check CHECK (version >= 1),
  CONSTRAINT work_items_updated_at_check CHECK (updated_at >= created_at),
  CONSTRAINT work_items_timing_check CHECK (
    (started_at IS NULL OR started_at >= created_at) AND
    (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
  ),
  CONSTRAINT work_items_terminal_consistency_check CHECK (
    (status IN ('ready', 'waiting_dependency', 'queued') AND started_at IS NULL AND completed_at IS NULL AND blocked_reason_code IS NULL) OR
    (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL AND blocked_reason_code IS NULL) OR
    (status = 'review_required' AND started_at IS NOT NULL AND completed_at IS NULL AND blocked_reason_code IS NULL) OR
    (status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= started_at AND blocked_reason_code IS NULL) OR
    (status = 'blocked' AND blocked_reason_code IS NOT NULL) OR
    (status = 'failed' AND completed_at IS NOT NULL AND completed_at >= created_at) OR
    (status = 'canceled' AND completed_at IS NOT NULL AND completed_at >= created_at)
  )
);

CREATE INDEX idx_work_items_order_status ON work_items (work_order_id, status);
CREATE INDEX idx_work_items_workspace_order ON work_items (workspace_id, work_order_id, created_at ASC);

CREATE TABLE work_item_dependencies (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  depends_on_work_item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT work_item_dependencies_unique UNIQUE (work_item_id, depends_on_work_item_id),
  CONSTRAINT work_item_dependencies_target_fk FOREIGN KEY (workspace_id, work_order_id, work_item_id) REFERENCES work_items(workspace_id, work_order_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_item_dependencies_source_fk FOREIGN KEY (workspace_id, work_order_id, depends_on_work_item_id) REFERENCES work_items(workspace_id, work_order_id, id) ON DELETE RESTRICT,
  CONSTRAINT work_item_dependencies_no_self_dep CHECK (work_item_id <> depends_on_work_item_id)
);

CREATE INDEX idx_work_item_deps_work_order ON work_item_dependencies (work_order_id);
CREATE INDEX idx_work_item_deps_depends_on ON work_item_dependencies (depends_on_work_item_id);

CREATE TABLE agent_assignments (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  role_definition_id UUID NOT NULL REFERENCES agent_role_definitions(id) ON DELETE RESTRICT,
  work_item_id UUID NULL,
  office_state TEXT NOT NULL,
  waiting_on_work_item_id UUID NULL,
  latest_report_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT agent_assignments_order_role_unique UNIQUE (work_order_id, role_definition_id),
  CONSTRAINT agent_assignments_workspace_work_order_fk FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT agent_assignments_work_item_fk FOREIGN KEY (workspace_id, work_order_id, work_item_id) REFERENCES work_items(workspace_id, work_order_id, id) ON DELETE RESTRICT,
  CONSTRAINT agent_assignments_waiting_item_fk FOREIGN KEY (workspace_id, work_order_id, waiting_on_work_item_id) REFERENCES work_items(workspace_id, work_order_id, id) ON DELETE RESTRICT,
  CONSTRAINT agent_assignments_office_state_check CHECK (
    office_state IN (
      'preparing',
      'queued',
      'running',
      'waiting_dependency',
      'review_required',
      'completed',
      'blocked',
      'failed',
      'canceled'
    )
  ),
  CONSTRAINT agent_assignments_waiting_check CHECK (
    (office_state = 'waiting_dependency' AND waiting_on_work_item_id IS NOT NULL) OR
    (office_state <> 'waiting_dependency' AND waiting_on_work_item_id IS NULL)
  ),
  CONSTRAINT agent_assignments_version_check CHECK (version >= 1),
  CONSTRAINT agent_assignments_updated_at_check CHECK (updated_at >= created_at)
);

CREATE INDEX idx_agent_assignments_workspace_order ON agent_assignments (workspace_id, work_order_id, created_at ASC);

-- Enforce: Chief of Staff is the only assignment allowed to have work_item_id IS NULL
CREATE OR REPLACE FUNCTION check_agent_assignment_chief_of_staff() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  role_k TEXT;
BEGIN
  SELECT role_key INTO role_k FROM agent_role_definitions WHERE id = NEW.role_definition_id;
  IF role_k = 'chief_of_staff' THEN
    IF NEW.work_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Chief of Staff assignment must not have a work item' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.work_item_id IS NULL THEN
      RAISE EXCEPTION 'Non-Chief of Staff assignment must have a work item' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_assignments_check_chief_of_staff
BEFORE INSERT OR UPDATE ON agent_assignments
FOR EACH ROW EXECUTE FUNCTION check_agent_assignment_chief_of_staff();
