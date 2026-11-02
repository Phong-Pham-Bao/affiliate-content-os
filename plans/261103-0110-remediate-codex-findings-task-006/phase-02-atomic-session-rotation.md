# Phase 02: Atomic Session Rotation Concurrency

## Context Links

- [authenticate-session.ts](../../packages/application/src/auth/authenticate-session.ts)
- [ports.ts](../../packages/application/src/auth/ports.ts)
- [postgres-session-adapter.ts](../../packages/infrastructure/src/auth/postgres-session-adapter.ts)
- [postgres-session-statements.ts](../../packages/infrastructure/src/auth/postgres-session-statements.ts)

## Overview

- Priority: HIGH
- Status: Pending
- Goal: Execute lock/read, expiry/user decision, rotation/touch/revocation, and the appropriate re-evaluation in one bounded PostgreSQL transaction.

## Requirements

- `SessionStorePort.withTransaction<T>` signature provides transactional `SessionStorePort`.
- `authenticateApplicationSession` wraps candidate query, checks, and mutations in `deps.sessionStore.withTransaction`.
- Concurrent requests for rotation serialize on row lock (`FOR UPDATE`); waiter re-evaluates as previous-token-grace without concurrency conflict.

## Implementation Steps

1. Update `SessionStorePort.withTransaction<T>(fn: (txStore: SessionStorePort) => Promise<T>): Promise<T>`.
2. Implement in `postgres-session-adapter.ts` with transaction runner wrapper.
3. In `authenticateApplicationSession`: execute within `withTransaction`, return explicit outcome, commit revocation/rotation, and re-evaluate cleanly.
4. Add concurrency tests forcing interleavings and verifying zero concurrency conflicts.
