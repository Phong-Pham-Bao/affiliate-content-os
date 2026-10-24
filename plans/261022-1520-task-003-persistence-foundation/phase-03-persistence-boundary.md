# Phase 03: Database Module in packages/infrastructure

## Context Links

- `tasks/TASK-003.md` (Section 4)
- `packages/infrastructure/package.json`
- `packages/infrastructure/src/database/*`

## Overview

- Create `@affiliate-content-os/infrastructure` with exact dependencies: `pg@8.23.1`, `@types/pg@8.23.1`.
- Public export `./database` (no deep imports).
- Module boundaries:
  - `createDatabase(config, options)` -> returns `Database` interface (query, withTransaction, probe, close, isClosing).
  - Explicit connection probe executing `SELECT 1`.
  - Idempotent close handling, rejecting new queries once close starts.
  - Transaction manager: `withTransaction<T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T>`
    - `BEGIN`, `COMMIT`, `ROLLBACK` on error, client release in `finally`.
    - `TransactionExecutor` does not expose `withTransaction` (no nesting).
    - Query parameters safely passed as arrays.
  - Error redaction: failure diagnostics strip connection strings, passwords, parameters.
- Unit tests with mock/fake `pg.Pool` and `pg.PoolClient` verifying exact call orders, error branches, and cleanup.

## Todo List

- [ ] Initialize `packages/infrastructure` package with tsconfig and dependencies
- [ ] Implement database client and pool lifecycle wrapper
- [ ] Implement transaction manager with strict callback boundary
- [ ] Implement connection probe and error sanitizer
- [ ] Write unit tests for database and transaction manager with fakes
