---
title: TASK-004 Remediation 04 - In-Flight Transaction Queries and Tainted Database Errors
description: Close the two remaining findings from Codex review of TASK-004 at commit cd216aa2b1a40fc130b17d31bdcf4d8bd866fec9
status: in_progress
priority: high
effort: 2
branch: agy/task-004-workspace-tenancy-core
tags: [tenancy, remediation, database-errors, transactions, postgres, in-flight-queries]
created: 2026-10-31
---

# TASK-004 Remediation 04 Plan

## Overview

Close the two remaining findings from the Codex review of TASK-004 (`tasks/TASK-004-REMEDIATION-04.md`):

1. **In-Flight Transaction Query Tracking and Quiescence**:
   - Register every `TransactionExecutor.query()` immediately when accepted.
   - Maintain an internal non-rejecting completion promise for every accepted query.
   - Caller-facing promise retains existing result and safe-error behavior.
   - Internal observation prevents unawaited rejected queries from becoming unhandled rejections without converting rejections to success.
   - Record first safe query failure before internal completion promise settles.
   - When callback settles: immediately deactivate executor, prohibit new queries, await settlement of every registered query before evaluating commit/rollback decisions.
   - If any registered query rejected: never issue `COMMIT`, never resolve successfully, attempt `ROLLBACK` once, release client exactly once, reject with first safe query failure.
   - An unawaited successful query completes before `COMMIT`; release client only after commit settles.
   - Escaped executor references remain unusable immediately after callback settlement.

2. **Genuine/Branded DatabaseError Routing and Observable Surface Closure**:
   - Distinguish branded `DatabaseError` callback rejections from application/business errors.
   - Route genuine `DatabaseError` rejections directly through `sanitizeDatabaseError()` rather than recursive generic callback sanitizer.
   - Preserve identity only when the complete observable error surface satisfies the closed `DatabaseError` invariant.
   - If tainted with own/inherited cause, unexpected own keys, symbols, accessors, hostile prototype, credentials, or hostile stack, return a fresh cause-free safe `DatabaseError`.
   - Never mutate the caller-owned error in place.
   - Never execute getters, proxies, toJSON, toString, custom inspection, coercion, logging, or prototype hooks.
   - Preserve non-database application/business rejection semantics via existing callback sanitizer.

3. **Regression Tests**:
   - Deferred-promise unit tests for unawaited success before commit/release.
   - Deferred-promise unit tests for unawaited failure preventing commit/release.
   - Fire-and-forget tests with and without caller catch, monitored for `unhandledRejection`.
   - Controlled settlement order of multiple concurrent queries.
   - Callback failure with pending queries.
   - Client, rollback, and release failures after late query failure.
   - Executor reuse while queries drain.
   - Real-PostgreSQL delayed-success and delayed-failure proof (with rollback of previous writes).
   - Tainted genuine `DatabaseError` observable surface test matrix.
   - Child process tests for stdout/stderr sentinels.

4. **Run All Quality and Security Gates**:
   - Run all format, lint, boundary, typecheck, unit, integration, build, audit, trivy, and clean-checkout gates.
