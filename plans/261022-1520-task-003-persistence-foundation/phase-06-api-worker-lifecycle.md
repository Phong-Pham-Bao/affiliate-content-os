# Phase 06: API and Worker Lifecycle Integration

## Context Links

- `tasks/TASK-003.md` (Section 7)
- `apps/api/src/*`, `apps/api/test/*`
- `apps/worker/src/*`, `apps/worker/test/*`

## Overview

- Wire database initialization and connection probe into API (`apps/api`) and worker (`apps/worker`) composition roots.
- Load runtime database config via `loadDatabaseConfig`.
- Instantiate database client and perform one-shot probe before starting listener / worker loop.
- If probe fails, clean up resources and exit nonzero before reporting startup.
- Preserve 5000ms default graceful shutdown deadline across all phases:
  - Startup cancellation / abort signal
  - Listener close / worker stop
  - Database pool close
- Single shared monotonic deadline; repeated signals observe the same promise.
- Tests with fake timers / monotonic clock verifying:
  - Probe success and probe failure
  - Shutdown during probe, during listener startup, during active runtime, during pool close
  - Bounded multi-stage cleanup within single 5000ms budget
  - Exactly-once termination with code 0 on success, code 1 on error/timeout

## Todo List

- [ ] Update `apps/api/src/server.ts` to accept/create database and execute probe before listen
- [ ] Update `apps/worker/src/runner.ts` / `worker.ts` to accept/create database and execute probe
- [ ] Wire shared monotonic deadline and abort controller through startup and shutdown
- [ ] Update unit tests for API server and worker lifecycles with injected fakes and clocks
