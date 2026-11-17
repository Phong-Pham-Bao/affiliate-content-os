-- 0013_compliance_human_approval.sql: Sprint 3 Checkpoint D compliance and human approval
-- Forward-only schema adding compliance evaluations, compliance findings,
-- content review decisions, and immutable approval snapshots.

-- 1. Extend operations and ai_runs check constraints to allow 'compliance_review'
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
      'scriptwriting',
      'compliance_review'
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
      'scriptwriting',
      'compliance_review'
    )
  );

-- 2. Compliance evaluations table
CREATE TABLE compliance_evaluations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  work_order_id UUID NOT NULL,
  artifact_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  policy_hash BYTEA NOT NULL,
  status TEXT NOT NULL,
  result TEXT NOT NULL,
  blocking_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  info_count INTEGER NOT NULL DEFAULT 0,
  deterministic_passed BOOLEAN NOT NULL DEFAULT FALSE,
  ai_advisory_status TEXT NOT NULL DEFAULT 'pending',
  evaluation_report_artifact_id UUID NULL,
  ai_run_id UUID NULL,
  job_id UUID NULL,
  operation_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT compliance_evaluations_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT compliance_evaluations_ws_art_rev_policy_unique UNIQUE (workspace_id, artifact_id, revision_number, policy_version, policy_hash),
  CONSTRAINT compliance_evaluations_ws_report_fk FOREIGN KEY (workspace_id, evaluation_report_artifact_id) REFERENCES content_artifacts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT compliance_evaluations_workspace_product_fk FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT compliance_evaluations_workspace_work_order_fk FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT compliance_evaluations_workspace_artifact_fk FOREIGN KEY (workspace_id, artifact_id) REFERENCES content_artifacts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT compliance_evaluations_workspace_rev_fk FOREIGN KEY (workspace_id, artifact_id, revision_number) REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number) ON DELETE RESTRICT,
  CONSTRAINT compliance_evaluations_workspace_job_fk FOREIGN KEY (workspace_id, job_id) REFERENCES job_executions(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT compliance_evaluations_workspace_op_fk FOREIGN KEY (workspace_id, operation_id) REFERENCES operations(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT compliance_evaluations_workspace_ai_run_fk FOREIGN KEY (workspace_id, ai_run_id) REFERENCES ai_runs(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT compliance_evaluations_policy_hash_len CHECK (octet_length(policy_hash) = 32),
  CONSTRAINT compliance_evaluations_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT compliance_evaluations_result_check CHECK (result IN ('pending', 'passed', 'warning', 'blocked', 'failed')),
  CONSTRAINT compliance_evaluations_ai_advisory_check CHECK (ai_advisory_status IN ('skipped', 'pending', 'completed', 'failed')),
  CONSTRAINT compliance_evaluations_counts_check CHECK (blocking_count >= 0 AND warning_count >= 0 AND info_count >= 0),
  CONSTRAINT compliance_evaluations_version_check CHECK (version >= 1),
  CONSTRAINT compliance_evaluations_updated_at_check CHECK (updated_at >= created_at)
);

CREATE INDEX idx_compliance_evals_artifact_rev ON compliance_evaluations (workspace_id, artifact_id, revision_number DESC);
CREATE INDEX idx_compliance_evals_status ON compliance_evaluations (workspace_id, status);
CREATE INDEX idx_compliance_evals_order ON compliance_evaluations (workspace_id, work_order_id);

CREATE OR REPLACE FUNCTION enforce_compliance_evaluations_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('completed', 'failed') THEN
      RAISE EXCEPTION 'terminal compliance_evaluations rows cannot be deleted' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('completed', 'failed') THEN
      RAISE EXCEPTION 'terminal compliance_evaluations rows are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER compliance_evaluations_enforce_immutability
BEFORE UPDATE OR DELETE ON compliance_evaluations
FOR EACH ROW EXECUTE FUNCTION enforce_compliance_evaluations_immutability();

-- 3. Compliance findings table (immutable)
CREATE TABLE compliance_findings (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  evaluation_id UUID NOT NULL,
  fingerprint BYTEA NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  source TEXT NOT NULL,
  video_number INTEGER NULL,
  field_path TEXT NOT NULL,
  message TEXT NOT NULL,
  evidence_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT compliance_findings_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT compliance_findings_ws_eval_fp_unique UNIQUE (workspace_id, evaluation_id, fingerprint),
  CONSTRAINT compliance_findings_workspace_eval_fk FOREIGN KEY (workspace_id, evaluation_id) REFERENCES compliance_evaluations(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT compliance_findings_fingerprint_len CHECK (octet_length(fingerprint) = 32),
  CONSTRAINT compliance_findings_severity_check CHECK (severity IN ('info', 'warning', 'blocking')),
  CONSTRAINT compliance_findings_source_check CHECK (source IN ('deterministic', 'ai_advisory')),
  CONSTRAINT compliance_findings_video_num_check CHECK (video_number IS NULL OR (video_number BETWEEN 1 AND 5)),
  CONSTRAINT compliance_findings_field_path_check CHECK (char_length(field_path) BETWEEN 1 AND 500),
  CONSTRAINT compliance_findings_message_check CHECK (char_length(message) BETWEEN 1 AND 2000),
  CONSTRAINT compliance_findings_evidence_ids_check CHECK (jsonb_typeof(evidence_ids_json) = 'array')
);

CREATE INDEX idx_compliance_findings_eval ON compliance_findings (workspace_id, evaluation_id);

CREATE OR REPLACE FUNCTION enforce_compliance_findings_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'compliance_findings rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER compliance_findings_enforce_immutability
BEFORE UPDATE OR DELETE ON compliance_findings
FOR EACH ROW EXECUTE FUNCTION enforce_compliance_findings_immutability();

-- 4. Content review decisions table (immutable)
CREATE TABLE content_review_decisions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  artifact_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  content_hash BYTEA NOT NULL,
  evaluation_id UUID NULL,
  decision TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT content_review_decisions_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT content_review_decisions_ws_art_fk FOREIGN KEY (workspace_id, artifact_id) REFERENCES content_artifacts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_review_decisions_ws_rev_fk FOREIGN KEY (workspace_id, artifact_id, revision_number) REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number) ON DELETE RESTRICT,
  CONSTRAINT content_review_decisions_ws_eval_fk FOREIGN KEY (workspace_id, evaluation_id) REFERENCES compliance_evaluations(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_review_decisions_hash_len CHECK (octet_length(content_hash) = 32),
  CONSTRAINT content_review_decisions_type_check CHECK (decision IN ('accept', 'reject', 'request_changes')),
  CONSTRAINT content_review_decisions_reason_check CHECK (
    reason IS NULL OR (char_length(reason) BETWEEN 1 AND 2000 AND reason = btrim(reason))
  ),
  CONSTRAINT content_review_decisions_meta_check CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX idx_content_review_decisions_art ON content_review_decisions (workspace_id, artifact_id, created_at DESC);
CREATE INDEX idx_content_review_decisions_rev ON content_review_decisions (workspace_id, artifact_id, revision_number);
CREATE UNIQUE INDEX idx_content_review_decisions_terminal ON content_review_decisions (workspace_id, artifact_id, revision_number) WHERE decision IN ('accept', 'reject');

CREATE OR REPLACE FUNCTION enforce_content_review_decisions_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content_review_decisions rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER content_review_decisions_enforce_immutability
BEFORE UPDATE OR DELETE ON content_review_decisions
FOR EACH ROW EXECUTE FUNCTION enforce_content_review_decisions_immutability();

-- 5. Content approval snapshots table (immutable)
CREATE TABLE content_approval_snapshots (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  artifact_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  content_hash BYTEA NOT NULL,
  evaluation_id UUID NOT NULL,
  policy_version TEXT NOT NULL,
  policy_hash BYTEA NOT NULL,
  decision_id UUID NOT NULL,
  approved_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evidence_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  disclosure_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_json JSONB NOT NULL,
  snapshot_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT content_approval_snapshots_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT content_approval_snapshots_ws_art_rev_unique UNIQUE (workspace_id, artifact_id, revision_number),
  CONSTRAINT content_approval_snapshots_ws_art_fk FOREIGN KEY (workspace_id, artifact_id) REFERENCES content_artifacts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_approval_snapshots_ws_rev_fk FOREIGN KEY (workspace_id, artifact_id, revision_number) REFERENCES content_artifact_revisions(workspace_id, artifact_id, revision_number) ON DELETE RESTRICT,
  CONSTRAINT content_approval_snapshots_ws_eval_fk FOREIGN KEY (workspace_id, evaluation_id) REFERENCES compliance_evaluations(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_approval_snapshots_ws_dec_fk FOREIGN KEY (workspace_id, decision_id) REFERENCES content_review_decisions(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT content_approval_snapshots_content_hash_len CHECK (octet_length(content_hash) = 32),
  CONSTRAINT content_approval_snapshots_policy_hash_len CHECK (octet_length(policy_hash) = 32),
  CONSTRAINT content_approval_snapshots_snapshot_hash_len CHECK (octet_length(snapshot_hash) = 32),
  CONSTRAINT content_approval_snapshots_evidence_check CHECK (jsonb_typeof(evidence_ids_json) = 'array'),
  CONSTRAINT content_approval_snapshots_disclosure_check CHECK (jsonb_typeof(disclosure_state_json) = 'object'),
  CONSTRAINT content_approval_snapshots_snapshot_check CHECK (jsonb_typeof(snapshot_json) = 'object')
);

CREATE INDEX idx_content_approval_snapshots_art ON content_approval_snapshots (workspace_id, artifact_id, revision_number);

CREATE OR REPLACE FUNCTION enforce_content_approval_snapshots_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'content_approval_snapshots rows are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER content_approval_snapshots_enforce_immutability
BEFORE UPDATE OR DELETE ON content_approval_snapshots
FOR EACH ROW EXECUTE FUNCTION enforce_content_approval_snapshots_immutability();
