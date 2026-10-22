# Phase 01: Findings Remediation

## Context Links

- [TASK-002](file:///C:/Users/Win%2010/affiliate-content-os/tasks/TASK-002.md)
- [AGENTS.md](file:///C:/Users/Win%2010/affiliate-content-os/AGENTS.md)
- [README.md](file:///C:/Users/Win%2010/affiliate-content-os/README.md)

## Overview

- Priority: High
- Current Status: Complete
- Description: Fix the 3 code/test findings and 1 documentation finding from Codex re-review.

## Key Insights

1. Worker Keep-Alive: Node.js `setInterval` violates the strict timer-free requirement. A real referenced runtime handle via `node:worker_threads` `MessagePort` (`port1.ref()`) maintains event loop activity in an idle state without any timers or CPU load, and cleanly unrefs/closes on abort.
2. Bounded API Shutdown: If `app.close()` times out or fails, logging without process termination leaves hung handles alive. Bounded shutdown must log failure and invoke a nonzero termination boundary (`terminate(1)`, defaulting to `process.exit(1)`), which is injected for unit testability.
3. Worker Signal Tests: `child.kill('SIGTERM')` on Windows causes `TerminateProcess` where `exit.signal = 'SIGTERM'` without executing signal handlers. Tests must verify that `SIGINT` and `SIGTERM` run the worker's graceful shutdown path, close resources, and result in exit code 0.

## Requirements

- Worker process operates with 0 timers and a real referenced handle.
- API shutdown enforces deadline and calls `terminate(1)` on timeout/failure.
- Tests prove graceful shutdown, resource closure, and exit code 0 for both `SIGINT` and `SIGTERM`.
- Documentation matches implementation without weakening constraints.

## Architecture

- `apps/worker`: `runWorker` accepts optional `runtimeHandle` (defaults to referenced `MessagePort`).
- `apps/api`: `startApiServer` accepts optional `terminate` function (defaults to `process.exit`).
- Signal handling is tested deterministically across Windows and CI.

## Related Code Files

- `apps/worker/src/worker.ts`
- `apps/worker/src/runner.ts`
- `apps/worker/src/main.ts`
- `apps/worker/test/worker.test.ts`
- `apps/api/src/server.ts`
- `apps/api/src/main.ts`
- `apps/api/test/app.test.ts`
- `README.md`

## Implementation Steps

1. Update `apps/worker/src/worker.ts`: remove `setInterval`, implement `MessagePort` referenced handle with clean closure on abort.
2. Update `apps/api/src/server.ts`: add `terminate` injection to `StartServerOptions`, log failure and trigger `terminate(1)` on close timeout or rejection.
3. Update `apps/worker/src/main.ts` and `apps/worker/src/runner.ts`: ensure graceful completion leads to code 0 exit.
4. Strengthen `apps/worker/test/worker.test.ts`: test both `SIGINT` and `SIGTERM` with code 0 verification, asserting 0 timers are registered.
5. Strengthen `apps/api/test/app.test.ts`: assert `terminate(1)` is called when shutdown times out or fails.
6. Verify all quality gates pass and working tree is clean.

## Todo List

- [x] Implement timer-free worker runtime handle in `apps/worker/src/worker.ts`
- [x] Implement bounded API shutdown and nonzero termination in `apps/api/src/server.ts`
- [x] Add tests for API termination injection in `apps/api/test/app.test.ts`
- [x] Add strengthened tests for worker `SIGINT` and `SIGTERM` in `apps/worker/test/worker.test.ts`
- [x] Update documentation in `README.md`
- [x] Run full test suite and quality gates
- [x] Clean up scratch files and verify git status

## Success Criteria

- Zero timers in worker idle state (`setInterval` and `setTimeout` spy assertions pass).
- API shutdown failure/timeout triggers `terminate(1)`.
- Worker tests prove graceful handling on both `SIGINT` and `SIGTERM` with code 0 exit.
- All workspace checks pass.
