---
title: Fix TASK-002 Codex Review Findings
description: Remediate Codex re-review findings on worker lifecycle, API bounded shutdown, and signal tests.
status: complete
priority: high
effort: medium
branch: agy/task-002-runtime-foundation
tags:
  - runtime
  - worker
  - api
  - lifecycle
  - signals
created: 2026-10-22
---

# Plan: Fix TASK-002 Codex Review Findings

Remediate all findings returned by Codex re-review (STATUS: CHANGES REQUIRED).

## Phases

| Phase    | Description                                                            | Status   |
| -------- | ---------------------------------------------------------------------- | -------- |
| Phase 01 | Remediate worker keep-alive handle (timer-free)                        | Complete |
| Phase 02 | Implement genuinely bounded API shutdown with forced termination       | Complete |
| Phase 03 | Strengthen worker lifecycle tests for SIGINT and SIGTERM (exit code 0) | Complete |
| Phase 04 | Synchronize documentation (README and cook report)                     | Complete |
| Phase 05 | Run full verification suite and verify clean checkout                  | Complete |

## Key Dependencies

- `apps/worker/src/worker.ts` & `apps/worker/src/runner.ts`
- `apps/api/src/server.ts` & `apps/api/src/main.ts`
- `apps/worker/test/worker.test.ts` & `apps/api/test/app.test.ts`
- `README.md`
