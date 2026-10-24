CREATE TABLE users (
  id UUID PRIMARY KEY,
  identity_provider TEXT NOT NULL,
  identity_subject TEXT NOT NULL,
  email TEXT NULL,
  display_name TEXT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT users_identity_provider_subject_unique UNIQUE (identity_provider, identity_subject),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled', 'deletion_pending')),
  CONSTRAINT users_identity_provider_not_empty_check CHECK (trim(identity_provider) <> ''),
  CONSTRAINT users_identity_subject_not_empty_check CHECK (trim(identity_subject) <> ''),
  CONSTRAINT users_version_check CHECK (version >= 1),
  CONSTRAINT users_updated_at_check CHECK (updated_at >= created_at)
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  timezone TEXT NOT NULL,
  brand_voice TEXT NULL,
  default_disclosure TEXT NULL,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT workspaces_slug_unique UNIQUE (slug),
  CONSTRAINT workspaces_slug_format_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT workspaces_status_check CHECK (status IN ('active', 'suspended', 'deletion_pending')),
  CONSTRAINT workspaces_name_not_empty_check CHECK (trim(name) <> ''),
  CONSTRAINT workspaces_timezone_not_empty_check CHECK (trim(timezone) <> ''),
  CONSTRAINT workspaces_version_check CHECK (version >= 1),
  CONSTRAINT workspaces_updated_at_check CHECK (updated_at >= created_at)
);

CREATE TABLE workspace_memberships (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  invited_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT workspace_memberships_workspace_user_unique UNIQUE (workspace_id, user_id),
  CONSTRAINT workspace_memberships_role_check CHECK (role IN ('owner', 'editor', 'viewer')),
  CONSTRAINT workspace_memberships_status_check CHECK (status IN ('active', 'suspended', 'removed')),
  CONSTRAINT workspace_memberships_active_joined_at_check CHECK (status <> 'active' OR joined_at IS NOT NULL),
  CONSTRAINT workspace_memberships_version_check CHECK (version >= 1),
  CONSTRAINT workspace_memberships_updated_at_check CHECK (updated_at >= created_at)
);

CREATE INDEX idx_workspace_memberships_user_workspace ON workspace_memberships (user_id, workspace_id);
CREATE INDEX idx_workspace_memberships_workspace_status ON workspace_memberships (workspace_id, status);
