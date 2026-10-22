---
title: Fix API Startup Bounded Shutdown Defect
description: Ensure API shutdown during permanently pending startup is bounded, removes listeners, logs failure, and invokes terminate(1) exactly once.
status: complete
priority: high
effort: small
branch: agy/task-002-runtime-foundation
tags:
  - api
  - lifecycle
  - shutdown
  - fastify
created: 2026-10-22
---

# Plan: Fix API Startup Bounded Shutdown Defect

Remediate remaining HIGH defect where close() during 'starting' state awaits startupPromise indefinitely.

## Phases

| Phase    | Description                                                      | Status   |
| -------- | ---------------------------------------------------------------- | -------- |
| Phase 01 | Bound shutdown during pending startup and ensure settlement      | Complete |
| Phase 02 | Add deterministic regression tests for hung startup cancellation | Complete |
| Phase 03 | Run full verification suite and verify clean checkout            | Complete |

## Key Dependencies

- `apps/api/src/server.ts`
- `apps/api/test/app.test.ts`
