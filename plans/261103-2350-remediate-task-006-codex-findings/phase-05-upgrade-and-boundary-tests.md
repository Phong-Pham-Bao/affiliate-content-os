# Phase 05: Add TASK-005 Upgrade, Boundary, and poolMax=1 Tests

## Context Links

- [auth-schema.integration.test.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/test/integration/auth-schema.integration.test.ts)
- [session-concurrency.integration.test.ts](file:///C:/Users/Win%2010/affiliate-content-os/packages/infrastructure/test/integration/session-concurrency.integration.test.ts)

## Overview

Add real-PostgreSQL integration test coverage for TASK-005-to-TASK-006 schema migration upgrade, timestamp equality boundaries, poolMax=1 concurrency, and exact grace boundaries.

## Implementation Steps

1. Add TASK-005 upgrade test in `auth-schema.integration.test.ts`:
   - Start with clean database, apply migrations `0001` and `0002`.
   - Seed TASK-005 users, workspaces, memberships.
   - Apply migration `0003_application_auth.sql`.
   - Verify all existing rows remain intact and new tables are created with proper constraints and FKs.
2. Add timestamp boundary equality test:
   - Prove that valid equality boundaries pass `application_sessions_timestamps_order_check`:
     - `created_at = rotated_at = last_seen_at = idle_expires_at < absolute_expires_at`
     - `idle_expires_at = absolute_expires_at`
3. Add poolMax=1 concurrency tests in `session-concurrency.integration.test.ts`:
   - Initialize `Database` with `poolMax: 1`.
   - Authenticate session, rotate, touch, revoke inactive user without deadlock or timeout.
   - Run concurrent requests on poolMax: 1.
4. Add forced concurrent schedules for old-token vs new-token:
   - Schedule order 1: old-token acquires lock first, then new-token.
   - Schedule order 2: new-token acquires lock first, then old-token.
5. Add exact grace expiry tests:
   - Exactly before grace (`now = graceValidUntil - 1ms`): accepted.
   - Exactly at grace boundary (`now = graceValidUntil`): accepted (`>=`).
   - Exactly after grace (`now = graceValidUntil + 1ms`): rejected / unauthenticated.

## Todo List

- [ ] Add TASK-005 upgrade scenario to `auth-schema.integration.test.ts`
- [ ] Add timestamp boundary equality assertions
- [ ] Add poolMax=1 integration tests
- [ ] Add forced concurrent schedules
- [ ] Add exact before/at/after grace boundary test cases
