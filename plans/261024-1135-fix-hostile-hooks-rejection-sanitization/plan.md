---
title: 'TASK-003: Fix Rejection Sanitization & Database Error Classification Hostile Hooks'
description: 'Remediate the two remaining HIGH security findings from TASK-003 review: prevent invocation of untrusted getters/observability hooks during rejection sanitization, and eliminate property-access vulnerabilities in raw database-error classification.'
status: complete
priority: P0
effort: 2h
branch: agy/task-003-persistence-foundation
tags:
  - database
  - security
  - sanitization
  - proxy-safety
  - reflection
created: 2026-10-24
---

# Fix Hostile Hooks & Property Access Sanitization Plan

## Phase Overview

- [x] **Phase 1: Reproduce Both Reviewer Cases & Add Failing Tests**
  - Reproduced Finding 1: Untrusted inspection hook writing secret URL to console.error during sanitization.
  - Reproduced Finding 2: Hostile code/message getters and throwing Proxy traps escaping sanitization.
- [x] **Phase 2: Implement Exception-Safe Rejection Sanitizer (`sanitization.ts`)**
  - Inspect own property descriptors inside fail-safe boundaries.
  - Never call user getters, setters, toJSON, toString, inspect, valueOf, or coercion/iteration hooks.
  - Never wrap hooks; replace unsafe/unprovable objects with fresh safe `DatabaseError`.
  - Do not attach original unsafe object to replacement `DatabaseError`.
  - Preserve identity for proven-safe values and falsy primitives.
- [x] **Phase 3: Implement Non-Throwing Total Classifier (`errors.ts`)**
  - Total non-throwing `classifyRawError` reading only safe own string data descriptors.
  - Fail-safe boundary in `sanitizeDatabaseError` preventing any exception from escaping.
  - Genuine DatabaseError descriptor validation before returning.
- [x] **Phase 4: Adversarial Test Suite for Finding 1**
  - Added tests for side-effecting getter, throwing getter, toJSON, toString, custom inspect, inspect, valueOf/coercion, throwing get trap, throwing getOwnPropertyDescriptor trap, throwing ownKeys trap, combinations of cycles and hostile hooks.
  - Added child-process regression test proving custom inspect hook never executes and no sentinel reaches stdout/stderr.
- [x] **Phase 5: Regression Test Suite for Finding 2**
  - Tested all paths: `query`, `probe`, `pool connect`, `transaction begin/query/commit/rollback`, `client release`, `database.close`, `pool error handling`.
- [x] **Phase 6: Verification & Quality Gates**
  - Executed all TASK-003 verification gates (`pnpm format:check`, `pnpm lint`, `pnpm lint:boundaries`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm verify:infrastructure-pins`, `pnpm verify:trivy-exception`, `pnpm check`). All passed with 0 errors.
- [x] **Phase 7: Git Commit & Push**
  - Ready to commit and push to `origin/agy/task-003-persistence-foundation`.
