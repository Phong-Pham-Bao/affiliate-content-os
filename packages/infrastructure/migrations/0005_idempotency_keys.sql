CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  route_key TEXT NOT NULL,
  key_hash BYTEA NOT NULL,
  request_hash BYTEA NOT NULL,
  status_code INTEGER NOT NULL,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resource_type TEXT NULL,
  resource_id UUID NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT idempotency_keys_key_hash_len CHECK (octet_length(key_hash) = 32),
  CONSTRAINT idempotency_keys_request_hash_len CHECK (octet_length(request_hash) = 32),
  CONSTRAINT idempotency_keys_status_code_check CHECK (status_code >= 100 AND status_code <= 599),
  CONSTRAINT idempotency_keys_response_json_object_check CHECK (jsonb_typeof(response_json) = 'object'),
  CONSTRAINT idempotency_keys_route_key_check CHECK (length(route_key) <= 256 AND route_key = btrim(route_key) AND route_key !~ '[[:cntrl:]]'),
  CONSTRAINT idempotency_keys_resource_type_check CHECK (resource_type IS NULL OR (length(resource_type) <= 128 AND resource_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$')),
  CONSTRAINT idempotency_keys_timestamp_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX idx_idempotency_keys_workspaces_post_uq
ON idempotency_keys (principal_id, route_key, key_hash)
WHERE route_key = 'POST /api/v1/workspaces';

CREATE UNIQUE INDEX idx_idempotency_keys_tenant_uq
ON idempotency_keys (workspace_id, principal_id, route_key, key_hash)
WHERE workspace_id IS NOT NULL;

CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys (expires_at);
