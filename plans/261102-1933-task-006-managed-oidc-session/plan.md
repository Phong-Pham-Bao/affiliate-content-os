---
title: 'TASK-006: Managed OIDC Login, Server Sessions, and Current-User HTTP Boundary'
description: 'Implementation of approved TASK-006: AuthConfig, migration 0003, crypto primitives, PostgreSQL auth adapters, application use cases, OIDC adapter, Fastify HTTP boundary, OpenAPI 3.1 drift check, and end-to-end tests.'
status: in-progress
priority: P1
effort: 12h
branch: agy/task-006-managed-oidc-session
tags:
  - config
  - infrastructure
  - application
  - api
  - oidc
  - session
  - postgresql
  - openapi
created: 2026-11-02
---

# TASK-006: Managed OIDC Login, Server Sessions, and Current-User Plan

## Overview

Implement provider-neutral managed OIDC authorization-code flow, atomic one-time login transactions, opaque PostgreSQL-backed sessions, TASK-005 verified identity resolution integration, and Fastify HTTP boundary (`/auth/login`, `/auth/callback`, `/api/v1/me`, `/api/v1/logout`).

## Phases

- [ ] **Phase 1: Authentication Configuration (`@affiliate-content-os/config`)** - `phase-01-auth-config.md`
- [ ] **Phase 2: Migration 0003 (`packages/infrastructure/migrations/0003_application_auth.sql`)** - `phase-02-migration-0003.md`
- [ ] **Phase 3: Cryptographic Primitives (`@affiliate-content-os/infrastructure/auth`)** - `phase-03-cryptographic-primitives.md`
- [ ] **Phase 4: PostgreSQL Auth Adapters (`@affiliate-content-os/infrastructure/auth`)** - `phase-04-postgresql-auth-adapters.md`
- [ ] **Phase 5: Application Contracts and Use Cases (`@affiliate-content-os/application`)** - `phase-05-application-contracts-and-use-cases.md`
- [ ] **Phase 6: OIDC Protocol Adapter (`@affiliate-content-os/infrastructure/auth`)** - `phase-06-oidc-adapter.md`
- [ ] **Phase 7: Session Lifecycle and Precedence** - `phase-07-session-lifecycle.md`
- [ ] **Phase 8: Fastify HTTP Boundary (`apps/api`)** - `phase-08-fastify-http-boundary.md`
- [ ] **Phase 9: Current-User and Workspace Summaries (`apps/api`, `@affiliate-content-os/infrastructure`)** - `phase-09-current-user-and-workspaces.md`
- [ ] **Phase 10: OpenAPI 3.1 Contract, Drift Gate, and Documentation** - `phase-10-openapi-and-documentation.md`
- [ ] **Phase 11: Security, Adversarial, Concurrency, and Final Verification** - `phase-11-final-verification.md`
