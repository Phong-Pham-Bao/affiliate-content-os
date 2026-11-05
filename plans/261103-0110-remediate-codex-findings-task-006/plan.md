---
title: Remediate Codex Findings for TASK-006
description: Comprehensive remediation of all 9 Codex findings for managed OIDC login and application session boundary
status: in_progress
priority: critical
effort: high
branch: agy/task-006-managed-oidc-session
tags: [auth, oidc, session, security, postgres, codex]
created: 2026-11-03
---

# TASK-006 Findings Remediation Plan

Remediate all 9 Codex findings across architecture, domain, application, infrastructure, API, and tests.

## Phase Index

1. [Phase 01: UUIDv7 Production Wiring](phase-01-uuidv7-production-wiring.md) - Status: Pending
2. [Phase 02: Atomic Session Rotation Concurrency](phase-02-atomic-session-rotation.md) - Status: Pending
3. [Phase 03: Hostile Accessors & Error Mappings](phase-03-hostile-values-and-error-mapper.md) - Status: Pending
4. [Phase 04: Callback Query Validation Order](phase-04-callback-query-validation.md) - Status: Pending
5. [Phase 05: Logout Error Propagation](phase-05-logout-error-propagation.md) - Status: Pending
6. [Phase 06: Workspace Roles Enum & OpenAPI](phase-06-openapi-and-workspace-roles.md) - Status: Pending
7. [Phase 07: Session Timestamp Database Constraints](phase-07-session-timestamp-invariants.md) - Status: Pending
8. [Phase 08: Startup/Discovery Ownership & Cancellation](phase-08-startup-discovery-ownership.md) - Status: Pending
9. [Phase 09: Strict Test OIDC Issuer & Integration Matrix](phase-09-strict-oidc-issuer-and-integration-matrix.md) - Status: Pending

## Key Dependencies & Invariants

- Preserve all TASK-005 and TASK-006 guarantees.
- Zero credential/token exposure in errors, stdout, stderr, or responses.
- Bounded graceful shutdown and single-owner lifecycle.
- Full verification gates must pass: unit, integration, lint, boundaries, typecheck, format, openapi, trivy, git diff --check.
