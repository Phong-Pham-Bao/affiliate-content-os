# Phase 02: Database Configuration in packages/config

## Context Links

- `tasks/TASK-003.md` (Section 3)
- `packages/config/src/*`
- `packages/config/test/*`

## Overview

- Extend `@affiliate-content-os/config` with typed database configuration loaders:
  - `loadDatabaseConfig(rawEnv?: unknown)` for runtime (API/worker)
  - `loadMigrationConfig(rawEnv?: unknown)` for migration CLI
  - `loadTestAdminDatabaseConfig(rawEnv?: unknown)` for test harness
- Add fields:
  - `DATABASE_URL`: postgresql:/postgres: URL, hostname and database required, no queries/fragments, credentials secret.
  - `DATABASE_POOL_MAX` (1-50, default 10)
  - `DATABASE_CONNECTION_TIMEOUT_MS` (100-60000, default 5000)
  - `DATABASE_IDLE_TIMEOUT_MS` (1000-300000, default 30000)
  - `DATABASE_STATEMENT_TIMEOUT_MS` (100-300000, default 15000)
  - `DATABASE_SSL_MODE`: `disable` (default in dev/test, restricted to loopback) | `verify-full` (required in production)
  - `DATABASE_SSL_CA_FILE`: absolute path required when `verify-full`, empty/absent when `disable`
  - `MIGRATION_DATABASE_URL`
  - `TEST_DATABASE_ADMIN_URL`
  - `TEST_DATABASE_DISPOSABLE`: exact literal `YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED`
- Redacted metadata helper updating `getRedactedConfigMetadata` or exposing database metadata helper without echoing URLs or credentials.
- Comprehensive unit tests covering all boundary conditions, invalid inputs, SSL modes, and non-disclosure.

## Todo List

- [ ] Define database config interfaces and constants in `packages/config/src/types.ts`
- [ ] Implement URL and integer parsing utilities in `packages/config/src/`
- [ ] Implement `validateDatabaseConfig`, `validateMigrationConfig`, `validateTestAdminConfig`
- [ ] Implement redaction updates for database configuration
- [ ] Write extensive unit tests in `packages/config/test/`
