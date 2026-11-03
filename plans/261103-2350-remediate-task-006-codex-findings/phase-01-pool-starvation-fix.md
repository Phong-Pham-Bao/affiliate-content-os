# Phase 01: Remediate poolMax=1 Self-Starvation

## Context Links

- [authenticate-session.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/application/src/auth/authenticate-session.ts)
- [postgres-session-adapter.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/src/auth/postgres-session-adapter.ts)
- [ports.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/application/src/auth/ports.ts)

## Overview

Perform user validation lookup through the same transaction-scoped connection during session authentication. Prevent root connection pool exhaustion when DATABASE_POOL_MAX=1.

## Implementation Steps

1. Add `findUserById(userId: UserId | string): Promise<UserSnapshot | null>` to `SessionStorePort` and `PostgresSessionAdapter`.
2. In `createAdapterForRunner(runner: QueryRunner)`, implement `findUserById` using `runner.query`. Map row safely via `mapUserRow` (or safe user row mapper).
3. In `authenticateApplicationSession`, invoke `store.findUserById(parsedUserId)` using the transaction store `store`. Keep `deps.userDirectory?.findUserById` as fallback for testing flexibility.
4. Update unit test fakes and integration tests.

## Todo List

- [ ] Add `findUserById` to `SessionStorePort` interface
- [ ] Implement `findUserById` in `PostgresSessionAdapter` on `createAdapterForRunner`
- [ ] Update `authenticateApplicationSession` to call `store.findUserById`
- [ ] Update application unit tests
