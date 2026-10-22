# Phase 05: Isolated Integration Testing Harness

## Context Links

- `tasks/TASK-003.md` (Section 6)
- `packages/infrastructure/test/integration/*`

## Overview

- Integration test isolation: unique database per suite or Vitest worker generated as `^acos_test_[0-9a-f]{1,48}$`.
- Strict pre-execution safety guards:
  - `NODE_ENV === 'test'`
  - `TEST_DATABASE_DISPOSABLE === 'YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED'`
  - Host is `localhost`, `127.0.0.1`, `::1` (or `postgres` in CI)
  - Admin DB name is `postgres`
  - Name is prefixed with `acos_test_` and not protected (`postgres`, `template0`, etc.)
- Connect to administrative database, create isolated database, run migrations, run tests, drop database in `finally`.
- Root command: `corepack pnpm test:integration`.
- Integration tests:
  - Real PostgreSQL commit/rollback
  - Parameter safety and SQL injection resistance
  - Concurrent independent transactions
  - Advisory lock concurrency between parallel migration runners
  - Migration validation: empty DB, applied state, second no-op run, drift detection with test fixtures

## Todo List

- [ ] Implement isolated database test helper with strict security guards
- [ ] Implement Vitest integration test config or filter
- [ ] Write database lifecycle integration tests (probe, query, transaction, rollback, pool timeout)
- [ ] Write migration integration tests (empty DB, sequential execution, advisory lock concurrency, drift fixtures)
- [ ] Wire `test:integration` script
