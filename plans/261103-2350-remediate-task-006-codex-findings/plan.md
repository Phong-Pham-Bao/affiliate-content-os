---
title: Remediate TASK-006 Codex Review Findings
description: Remediate one-connection pool starvation, hostile value traps, malformed callback encoding, canonical returnTo validation, and missing integration test scenarios.
status: complete
priority: high
effort: medium
branch: agy/task-006-managed-oidc-session
tags:
  - auth
  - oidc
  - security
  - persistence
  - review-remediation
created: 2026-11-03T23:50:00.000Z
---

# Plan: Remediate TASK-006 Codex Review Findings

## Overview

Remediate all 5 findings reported by Codex review for TASK-006:

1. One-connection pool starvation during session authentication
2. Hostile proxy, getter, and descriptor traps escaping as raw errors
3. Malformed callback percent-encoding consuming pending login transactions
4. Canonical returnTo path validation and query multiplicity
5. Missing TASK-005 upgrade, timestamp equality boundary, and poolMax=1 concurrency tests

## Phases

- [x] Phase 0: Research root causes and document plan
- [x] Phase 1: Remediate poolMax=1 self-starvation via transaction-scoped user lookup
- [x] Phase 2: Eliminate hostile value getter/proxy traps across application and adapters
- [x] Phase 3: Enforce raw callback percent-encoding validation before transaction consumption
- [x] Phase 4: Implement canonical local-path validator and query multiplicity for returnTo
- [x] Phase 5: Add TASK-005 upgrade, timestamp equality, and poolMax=1 concurrency tests
- [x] Phase 6: Run full verification gates and generate progress report
