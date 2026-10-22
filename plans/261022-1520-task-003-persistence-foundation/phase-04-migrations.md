# Phase 04: Forward-Only Migration Engine

## Context Links

- `tasks/TASK-003.md` (Section 5)
- `packages/infrastructure/migrations/0001_baseline.sql`
- `packages/infrastructure/src/database/migrations/*`

## Overview

- Forward-only SQL migrations with discovery grammar `^\d{4}_[a-z0-9_]+\.sql$`.
- Contiguous numbering strictly starting from `0001` to highest number with zero gaps.
- Session-level PostgreSQL advisory lock (fixed 64-bit integer derived deterministically, e.g. hashtext of project identifier or fixed key).
- Tracking table: `schema_migrations` (`migration_number`, `name`, `checksum_sha256`, `applied_at`).
- `0001_baseline.sql`: creates `schema_migrations` table and records itself via runner.
- Drift detection: checksum matching, renames, missing files, duplicate numbers, unknown DB migrations.
- CLI commands:
  - `corepack pnpm db:migrate` (runs pending migrations)
  - `corepack pnpm db:migrate:status` (read-only, checks drift/pending)
  - `corepack pnpm db:migrate:validate` (creates isolated DB, runs migrations, verifies status/no-op, drops DB in finally)

## Todo List

- [ ] Create `0001_baseline.sql`
- [ ] Implement migration discovery and contiguous number validation
- [ ] Implement migration runner with advisory locking and transaction per migration
- [ ] Implement migration status and drift verification logic
- [ ] Implement CLI entry points and npm scripts
- [ ] Add unit tests for migration runner and validation logic
