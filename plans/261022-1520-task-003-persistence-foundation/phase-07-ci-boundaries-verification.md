# Phase 07: Boundaries, CI Pipeline, Documentation & Gates

## Context Links

- `tasks/TASK-003.md` (Sections 1, 8, 9)
- `.dependency-cruiser.js`
- `.github/workflows/ci.yml`
- `README.md`

## Overview

- Architecture boundaries:
  - Update `.dependency-cruiser.js` allowing `apps/api` and `apps/worker` to import `@affiliate-content-os/infrastructure/database`.
  - Enforce that `apps/web`, `packages/domain`, `packages/application`, `packages/config` cannot import `packages/infrastructure`.
  - Enforce that `packages/infrastructure` does not import `apps/*` or other forbidden packages.
  - Update `test/boundaries.test.ts` to verify positive and negative rules.
- CI Workflow:
  - Add PostgreSQL service container to integration job using exact digest `postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc`.
  - Add dependency audit: `corepack pnpm audit --prod --audit-level high`.
  - Add Trivy container scan: `aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567 # v0.3.1`, version `v0.76.1`, scan image with exact required parameters.
  - Run `db:migrate:validate` and `test:integration` in CI.
- Documentation:
  - Update `README.md` with complete developer guide, commands, and environment setup.
- Execute full verification suite.

## Todo List

- [ ] Update `.dependency-cruiser.js` and boundary tests
- [ ] Update `.github/workflows/ci.yml` with PostgreSQL service, audit, and Trivy scan
- [ ] Update `README.md`
- [ ] Run all quality gates and verification commands
