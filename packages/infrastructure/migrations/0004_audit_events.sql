CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  result TEXT NOT NULL,
  reason_code TEXT NULL,
  changes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash TEXT NULL,
  user_agent_summary TEXT NULL,
  correlation_id UUID NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT audit_events_actor_type_check CHECK (actor_type IN ('user', 'system')),
  CONSTRAINT audit_events_result_check CHECK (result IN ('succeeded', 'denied', 'failed')),
  CONSTRAINT audit_events_actor_consistency_check CHECK (
    (actor_type = 'user' AND actor_user_id IS NOT NULL) OR
    (actor_type = 'system' AND actor_user_id IS NULL)
  ),
  CONSTRAINT audit_events_action_check CHECK (length(action) <= 128 AND action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  CONSTRAINT audit_events_resource_type_check CHECK (length(resource_type) <= 128 AND resource_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  CONSTRAINT audit_events_reason_code_check CHECK (reason_code IS NULL OR (length(reason_code) <= 128 AND reason_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$')),
  CONSTRAINT audit_events_changes_object_check CHECK (jsonb_typeof(changes_json) = 'object' AND jsonb_array_length(jsonb_path_query_array(changes_json, '$.keyvalue()')) <= 32),
  CONSTRAINT audit_events_ip_hash_check CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_events_user_agent_summary_check CHECK (user_agent_summary IS NULL OR (char_length(user_agent_summary) BETWEEN 1 AND 128 AND user_agent_summary = btrim(user_agent_summary) AND user_agent_summary !~ '[[:cntrl:]]')),
  CONSTRAINT audit_events_timestamp_check CHECK (created_at >= occurred_at)
);

CREATE INDEX idx_audit_events_workspace_cursor ON audit_events (workspace_id, occurred_at DESC, id DESC);
CREATE INDEX idx_audit_events_workspace_resource ON audit_events (workspace_id, resource_type, resource_id, occurred_at DESC);
CREATE INDEX idx_audit_events_workspace_actor ON audit_events (workspace_id, actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_audit_events_correlation ON audit_events (correlation_id) WHERE correlation_id IS NOT NULL;

CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE TRIGGER audit_events_prevent_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_event_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;
