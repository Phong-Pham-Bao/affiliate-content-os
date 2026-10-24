CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_number INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum_sha256 TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
