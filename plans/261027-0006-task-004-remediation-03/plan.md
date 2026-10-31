---
title: TASK-004 Remediation 03 - Transaction Failure Safety and Error Surface Closure
description: Close the three findings from Codex re-review of TASK-004 at commit 7eb32bb07cae1e95a71e62278246784eda119079
status: in_progress
priority: high
effort: 2
branch: agy/task-004-workspace-tenancy-core
tags: [tenancy, remediation, database-errors, transactions, postgres, timestamps]
created: 2026-10-27
---

# TASK-004 Remediation 03 Plan

## Overview

Close the three findings from the Codex re-review of TASK-004 (`tasks/TASK-004-REMEDIATION-03.md`):

1. **Remove arbitrary causes from `DatabaseError`**:
   - Remove `cause` option from `DatabaseError` constructor contract.
   - Omit `cause` from `toJSON()`, custom inspect, and all observable surfaces.
   - `sanitizeDatabaseError` never attaches inspected input as `cause` or metadata.
   - Verify genuine safe `DatabaseError` identity only if all observable fields satisfy the closed contract.
   - Add hostile cause tests across keys, JSON, string, inspection, stack, and child process.

2. **Restore safe transaction query boundary and make failure sticky**:
   - Wrap `client.query()` in `TransactionExecutor.query()` with immediate `sanitizeDatabaseError()`.
   - Never expose raw driver errors, constraints, queries, params, or connection data to callback.
   - Record first safe query failure as sticky failure.
   - After any query rejection: never issue `COMMIT`, never resolve with callback result, attempt `ROLLBACK` once, release client exactly once, reject with first safe query failure.
   - Comprehensive unit and integration tests covering callback swallowing query error, multiple errors, rollback/release failures, command ordering, and real-PostgreSQL statement failure caught in callback.

3. **Explicit SQL workspace slug conflict path**:
   - Replace raw error constraint inspection with `INSERT INTO workspaces ... ON CONFLICT (slug) DO NOTHING RETURNING id`.
   - Map `rowCount === 0` to `SlugConflictError(params.workspace.slug)`.
   - Remove raw error code/constraint inspection from tenancy adapter.
   - Any query failure remains safe `DatabaseError` and never maps to `SlugConflictError`.

4. **Reject undefined joined_at in membership mapper**:
   - Accept exactly `null` for `joined_at` and map to `null`.
   - Pass non-null values to `mapRowTimestamp`, rejecting `undefined` and invalid types with safe `DatabaseError`.

5. **Run all verification gates and clean-checkout checks**:
   - Run format, lint, boundary, typecheck, unit, integration, build, audit, trivy, and clean-checkout gates.
