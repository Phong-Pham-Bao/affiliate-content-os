---
title: Remediate TASK-006 Review Changes Required
description: Remediate hostile proxies, byte snapshots, closed keys, callback mutual exclusivity, controls, and mandatory transaction-scoped user lookup.
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
created: 2026-11-04T01:35:00.000Z
---

# Plan: Remediate TASK-006 Review Changes Required

## Overview

Address all 3 HIGH severity issues identified by Codex review:

1. Safe proxy detection before any observable operation, safe byte snapshots without reading attacker-overridable properties, and closed key set enforcement at DTO boundaries.
2. Callback mutually exclusive exact shapes (success vs denial), rejection of C0/DEL controls and ambiguous separators before consumption, ensuring zero downstream/transaction calls on malformed input.
3. Mandatory `SessionStorePort.findUserById` without root-pool fallback in session authentication.

## Phases

- [x] Phase 1: Issue 1 - Safe proxy detection, safe byte snapshot, and closed key sets
- [x] Phase 2: Issue 2 - Mutually exclusive callback shapes, C0/DEL controls, and zero-consumption rejection
- [x] Phase 3: Issue 3 - Mandatory transaction-scoped user lookup, remove root fallback
- [x] Phase 4: Unit, adversarial, integration verification, and report generation
