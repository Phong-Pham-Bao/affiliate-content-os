---
title: TASK-004 Remediation 01 - Validation, Immutable Snapshots, Conflict Mapping, and Schema Proof
description: Correct the five findings from Codex review of TASK-004 without expanding feature scope
status: completed
priority: high
effort: 3
branch: agy/task-004-workspace-tenancy-core
tags: [tenancy, remediation, validation, postgres, snapshots]
created: 2026-10-25
---

# TASK-004 Remediation 01 Plan

## Overview

Remediated all 5 findings from Codex review of TASK-004 (`tasks/TASK-004-REMEDIATION-01.md`):

1. Narrow slug conflict mapping to exact constraint `workspaces_slug_unique`.
2. Strict `aiEnabled` runtime validation before any dependency call.
3. Observably immutable snapshot timestamps (`IsoTimestamp` canonical RFC 3339 UTC strings).
4. Canonical timezone membership validation with exact approved overrides (`UTC`, `Etc/UTC`, `Asia/Ho_Chi_Minh`).
5. Complete real-PostgreSQL negative constraints, column-order, foreign key restrict, and blocked delete schema matrix.

## Implementation Report

- Cook report: [cook-261026-0015-task-004-remediation-01.md](file:///C:/Users/Win%2010/affiliate-content-os/plans/reports/cook-261026-0015-task-004-remediation-01.md)
