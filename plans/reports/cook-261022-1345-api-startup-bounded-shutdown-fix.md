# Implementation Report: API Startup Bounded Shutdown Defect Fix

**Date:** 2026-10-22
**Branch:** `agy/task-002-runtime-foundation`
**Status:** READY FOR CODEX REVIEW

## 1. Summary of Changes

Remediated the lifecycle defect in `apps/api/src/server.ts` where receiving `SIGINT` or `SIGTERM` during a permanently pending startup previously hung indefinitely:

1. **Bounded Wait for Startup During Shutdown:**
   - In `apps/api/src/server.ts`, replaced the unbounded `await startupPromise` in `close()` during `'starting'` state with a race against the configured shutdown timeout (`shutdownTimeoutMs`).
   - Introduced an internal startup abort mechanism (`startupAbortPromise` via `rejectStartup`) to immediately settle/reject the pending `startApiServer()` call when shutdown times out.
   - When the shutdown deadline expires:
     - Removes both `SIGINT` and `SIGTERM` signal handlers immediately.
     - Logs a sanitized shutdown failure to `console.error`.
     - Invokes injected `terminate(1)` exactly once via idempotent guard (`invokeTerminate`).
     - Rejects both `startApiServer()` and `close()` promises, allowing callers and tests to observe promise settlement without hanging.

2. **Idempotence and Safe Cleanup:**
   - Guarded termination calls with `terminated = true` to prevent duplicate termination calls across repeated signals (`SIGINT`, `SIGTERM`).
   - Cleaned up signal handlers eagerly upon initiating shutdown.
   - Preserved normal successful startup and graceful shutdown paths.
   - Preserved normal startup rejection propagation without listener leakage.

3. **Deterministic Regression Tests:**
   - Added regression test in `apps/api/test/app.test.ts` with a permanently pending listener (`() => new Promise(() => {})`).
   - Verified that when `SIGINT` or `SIGTERM` arrives while startup is pending:
     - Shutdown completes within the configured deadline.
     - `terminate(1)` is invoked exactly once.
     - Both signal handlers are removed.
     - Sanitized failure is logged.
     - `startApiServer()` settles (rejects with the timeout error).
     - Repeated signals remain idempotent.

## 2. Verification Commands & Results

- `corepack pnpm format:check` -> Passed
- `corepack pnpm lint:boundaries` -> Passed
- `corepack pnpm lint` -> Passed
- `corepack pnpm typecheck` -> Passed
- `corepack pnpm test` -> Passed (8 test suites, 85 tests passed)
- `corepack pnpm build` -> Passed
- `corepack pnpm check` -> Passed
- `corepack pnpm audit --audit-level high` -> Passed (0 vulnerabilities)
- `git diff --check origin/main...HEAD` -> Passed (0 whitespace errors)
