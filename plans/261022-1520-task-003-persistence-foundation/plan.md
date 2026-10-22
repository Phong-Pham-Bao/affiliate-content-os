---
title: 'TASK-003: PostgreSQL, Persistence, Local Infrastructure, and CI Foundation'
description: 'Implementation of TASK-003 as approved: Docker Compose, configuration, pg foundation, forward migrations, integration testing, process lifecycles, and CI.'
status: completed
priority: P1
effort: 8h
branch: agy/task-003-persistence-foundation
tags:
  - database
  - postgresql
  - infrastructure
  - migrations
  - ci
created: 2026-10-22
---

# TASK-003: PostgreSQL and Persistence Foundation Implementation Plan

## Phase Overview

- [x] **Phase 1: Local Infrastructure and Pin Verification** - `phase-01-local-infra-pins.md`
  - Compose configuration with verified manifest-list digest `sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc`.
  - Atomic local env setup script (`env:local`) and pin verification script (`verify:infrastructure-pins`).
- [x] **Phase 2: Database Configuration in packages/config** - `phase-02-config-integration.md`
  - Strongly typed, validated, immutable loaders for runtime, migration, and test admin environments.
  - Strict SSL mode mappings (`disable` vs `verify-full`), CA path/trust checks, URL validation, and redaction.
- [x] **Phase 3: Database Module in packages/infrastructure** - `phase-03-persistence-boundary.md`
  - `@affiliate-content-os/infrastructure` with `./database` public export, pinned `pg@8.23.1`.
  - Safe pool lifecycle, one-shot connection probe, idempotent shutdown, non-leaking transaction API.
- [x] **Phase 4: Forward-Only Migration Engine** - `phase-04-migrations.md`
  - Migration discovery (contiguous `0001_...` naming), session advisory locks, `schema_migrations` tracking.
  - `0001_baseline.sql`, migration commands (`db:migrate`, `db:migrate:status`, `db:migrate:validate`).
- [x] **Phase 5: Isolated Integration Testing Harness** - `phase-05-integration-testing.md`
  - Guarded test DB lifecycle (`acos_test_*`), parallel Vitest worker isolation, full integration test suite.
- [x] **Phase 6: API and Worker Lifecycle Integration** - `phase-06-api-worker-lifecycle.md`
  - Injected runtime DB wiring, connection probe before listen/run, shared 5000ms deadline, abort handling.
- [x] **Phase 7: Boundaries, CI Pipeline, Documentation & Gates** - `phase-07-ci-boundaries-verification.md`
  - Dependency cruiser rules, `.github/workflows/ci.yml` (PostgreSQL service, Trivy v0.76.1, pnpm audit), docs.
