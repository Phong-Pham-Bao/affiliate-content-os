---
title: TASK-004 Remediation 02 - Private Constraint Classification and Canonical Timestamp Input
description: Correct the two findings from Codex re-review of TASK-004 without expanding feature scope
status: in_progress
priority: high
effort: 2
branch: agy/task-004-workspace-tenancy-core
tags: [tenancy, remediation, database-errors, timestamps, postgres]
created: 2026-10-26
---

# TASK-004 Remediation 02 Plan

## Overview

Close the two remaining findings from the Codex re-review of TASK-004 (`tasks/TASK-004-REMEDIATION-02.md`):

1. **Keep PostgreSQL constraint payloads private**:
   - Remove `constraint` property from public `DatabaseError` surface (`DatabaseError`, constructor options, `toJSON()`, custom inspect, keys, JSON serialization).
   - `sanitizeDatabaseError` never attaches or copies constraint metadata.
   - Tenancy adapter keeps exact slug constraint classification (`workspaces_slug_unique`) private to the inner transaction catch boundary where it owns the raw driver error.
   - Remove outer catch fallback that relies on sanitized constraint. Outer catch only passes through already constructed `SlugConflictError` and fails closed to safe `DatabaseError`.
   - Comprehensive regression tests for hostile constraints, sentinel non-disclosure across all observable surfaces (message, stack, inspect, JSON, child process).

2. **Validate original timestamp strings before conversion**:
   - For string timestamp inputs: validate directly with `parseIsoTimestamp` exactly as received without prior normalization, conversion, or trimming.
   - Reject parseable noncanonical strings (missing ms, space separator, timezone offset, lowercase z, extra precision, whitespace, date-only, etc.) with safe `DatabaseError`.
   - For valid `Date` inputs: convert independently via `toISOString()` to immutable canonical string.
   - Apply consistently across all timestamp fields in `UserSnapshot`, `WorkspaceSnapshot`, and `WorkspaceMembershipSnapshot` (including nullable `joinedAt`).
   - Add table-driven canonical and noncanonical regression matrix for all timestamp fields.
