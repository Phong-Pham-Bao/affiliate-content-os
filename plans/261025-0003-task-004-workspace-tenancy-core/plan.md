---
title: 'TASK-004: Workspace Tenancy Core and PostgreSQL Isolation'
description: 'Implementation of TASK-004 as approved: domain identity/workspace models, application ports and CreateWorkspace use case, migration 0002, PostgreSQL tenancy adapter, and isolation tests.'
status: in_progress
priority: P1
effort: 8h
branch: agy/task-004-workspace-tenancy-core
tags:
  - domain
  - application
  - tenancy
  - postgresql
  - migrations
  - boundaries
created: 2026-10-25
---

# TASK-004: Workspace Tenancy Core and PostgreSQL Isolation Plan

## Phase Overview

- [ ] **Phase 1: Domain Package (@affiliate-content-os/domain)** - `phase-01-domain-package.md`
  - Canonical UUIDv7 types and deterministic validators (`UserId`, `WorkspaceId`, `MembershipId`).
  - Closed sets: `UserStatus`, `WorkspaceStatus`, `WorkspaceRole`, `MembershipStatus`.
  - Immutable snapshots: `UserSnapshot`, `WorkspaceSnapshot`, `WorkspaceMembershipSnapshot`.
  - Deterministic validators: workspace name, normalized slug (`^[a-z0-9]+(-[a-z0-9]+)*$`), runtime IANA timezone.
  - Domain unit test suite.

- [ ] **Phase 2: Application Package (@affiliate-content-os/application)** - `phase-02-application-package.md`
  - Application ports: `UserDirectoryPort`, `WorkspacePersistencePort`, `ClockPort`, `IdGeneratorPort`.
  - Application errors: `UserNotFoundError`, `InactiveUserError`, `SlugConflictError`, `ValidationError`.
  - `CreateWorkspace` use case: validation, active-user verification, injected ID/clock, atomic delegation.
  - Application unit test suite with deterministic fakes.

- [ ] **Phase 3: Database Migration 0002 (Identity & Tenancy)** - `phase-03-migration-schema.md`
  - Forward-only migration `packages/infrastructure/migrations/0002_identity_tenancy.sql`.
  - Exact tables: `users`, `workspaces`, `workspace_memberships`.
  - Check constraints, foreign keys (`ON DELETE RESTRICT`), unique indexes, and lookup indexes.
  - Migration sequence validation.

- [ ] **Phase 4: PostgreSQL Tenancy Adapter (@affiliate-content-os/infrastructure/tenancy)** - `phase-04-infrastructure-adapter.md`
  - Public export `./tenancy` in `@affiliate-content-os/infrastructure`.
  - User resolution by ID without environment access.
  - Atomic workspace + owner membership insertion in a single transaction with slug conflict mapping.
  - Membership-scoped reads enforcing `(workspaceId, userId)` active-membership predicate.
  - Parameterized queries and explicit row mapping.

- [ ] **Phase 5: Real-PostgreSQL Integration Testing** - `phase-05-testing-isolation.md`
  - Migration execution and relation/constraint/index inspection against real PostgreSQL 18.6.
  - Atomic creation, rollback on forced failure, concurrent slug collision tests.
  - Two-user/two-workspace isolation matrix in both directions, covering suspended and removed memberships.
  - Direct database constraint violation tests.

- [ ] **Phase 6: Architecture Boundaries, CI & Verification** - `phase-06-boundaries-verification.md`
  - Manifest and lockfile synchronization.
  - Update architecture boundary tests in `test/boundaries.test.ts`.
  - Execute full required verification command suite.
  - Clean checkout validation and final reporting.
