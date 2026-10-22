# Phase 01: Fix API Startup Bounded Shutdown Defect

## Context Links

- [TASK-002](file:///C:/Users/Win%2010/affiliate-content-os/tasks/TASK-002.md)
- [apps/api/src/server.ts](file:///C:/Users/Win%2010/affiliate-content-os/apps/api/src/server.ts)
- [apps/api/test/app.test.ts](file:///C:/Users/Win%2010/affiliate-content-os/apps/api/test/app.test.ts)

## Overview

- Priority: High
- Current Status: Complete
- Description: Remediate the unbounded wait for startupPromise when shutdown occurs while the server is in 'starting' state.

## Key Insights

- When `listener` is permanently pending, `close()` in `'starting'` state previously awaited `startupPromise` without a bound.
- The shutdown timeout in `executeClose()` was never reached.
- `startApiServer` hung on line 124 awaiting `startupPromise`, and `closePromise` hung on line 80 awaiting `startupPromise`.
- Bounded shutdown must race startup against the shutdown deadline, remove both signal handlers, log sanitized failure, invoke `terminate(1)` exactly once, and ensure both start and close promises settle.

## Requirements

1. A shutdown request while startup is pending must not await `startupPromise` indefinitely.
2. When the shutdown deadline expires:
   - remove both signal handlers;
   - log a sanitized shutdown failure;
   - invoke `terminate(1)` exactly once;
   - ensure the start/shutdown operation settles or rejects when the injected terminate function returns during tests.
3. Repeated `SIGINT` and `SIGTERM` events must remain idempotent and must not cause duplicate termination calls.
4. Normal successful startup and graceful shutdown must continue to work.
5. Startup rejection must continue to propagate safely without leaking listeners.
6. Add deterministic regression tests with a listener that never resolves.

## Architecture

- `startApiServer`: races `startupPromise` against an internal shutdown abort promise.
- `close()`: when called in `'starting'`, races `startupPromise` against `shutdownTimeoutMs`. On timeout, cleans up listeners, logs failure, calls `invokeTerminate(1)`, and rejects both the start and close promises.

## Related Code Files

- `apps/api/src/server.ts`
- `apps/api/test/app.test.ts`

## Todo List

- [x] Update `apps/api/src/server.ts` to bound startup during shutdown and settle promises on deadline
- [x] Add regression test in `apps/api/test/app.test.ts` with permanently pending listener
- [x] Run full test suite and quality gates
- [x] Update implementation reports
