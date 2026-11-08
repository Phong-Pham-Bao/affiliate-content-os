-- 0011_checkpoint_c_hardening.sql: Checkpoint C tenant constraints and unit uniqueness hardening
-- Forward-only schema adding composite workspace foreign keys, null-aware unit uniqueness,
-- and cross-tenant/artifact lineage integrity constraints.

-- 1. Composite workspace foreign keys from script_generation_units to operations, ai_runs, and job_executions
ALTER TABLE script_generation_units
  ADD CONSTRAINT script_generation_units_ws_operation_fk
    FOREIGN KEY (workspace_id, operation_id)
    REFERENCES operations(workspace_id, id) ON DELETE RESTRICT;

ALTER TABLE script_generation_units
  ADD CONSTRAINT script_generation_units_ws_ai_run_fk
    FOREIGN KEY (workspace_id, ai_run_id)
    REFERENCES ai_runs(workspace_id, id) ON DELETE RESTRICT;

ALTER TABLE script_generation_units
  ADD CONSTRAINT script_generation_units_ws_job_fk
    FOREIGN KEY (workspace_id, job_id)
    REFERENCES job_executions(workspace_id, id) ON DELETE RESTRICT;

-- 2. Database uniqueness for initial and change-request script generation units
-- Prevents duplicate initial video units for a work order (PostgreSQL-null semantics)
CREATE UNIQUE INDEX uq_script_gen_units_initial
  ON script_generation_units (workspace_id, work_order_id, video_number)
  WHERE change_request_id IS NULL;

-- Prevents duplicate change-request video units for a change request
CREATE UNIQUE INDEX uq_script_gen_units_change_request
  ON script_generation_units (workspace_id, change_request_id, video_number)
  WHERE change_request_id IS NOT NULL;

-- 3. Composite unique constraint on artifact_change_requests for artifact-scoped lineage foreign keys
ALTER TABLE artifact_change_requests
  ADD CONSTRAINT artifact_change_requests_ws_art_id_unique
    UNIQUE (workspace_id, artifact_id, id);

-- Foreign key ensuring change requests cannot link to a resulting revision from another artifact or workspace
ALTER TABLE artifact_change_requests
  ADD CONSTRAINT artifact_change_requests_ws_result_rev_fk
    FOREIGN KEY (workspace_id, artifact_id, resulting_revision_number)
    REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number) ON DELETE RESTRICT;

-- 4. Harden content_artifact_lineage to ensure change requests cannot cross artifacts or workspaces
ALTER TABLE content_artifact_lineage
  DROP CONSTRAINT IF EXISTS content_artifact_lineage_ws_change_req_fk;

ALTER TABLE content_artifact_lineage
  ADD CONSTRAINT content_artifact_lineage_ws_art_change_req_fk
    FOREIGN KEY (workspace_id, artifact_id, change_request_id)
    REFERENCES artifact_change_requests(workspace_id, artifact_id, id) ON DELETE RESTRICT;
