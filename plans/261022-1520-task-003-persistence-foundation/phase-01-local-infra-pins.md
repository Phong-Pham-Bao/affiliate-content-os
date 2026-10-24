# Phase 01: Local Infrastructure and Pin Verification

## Context Links

- `tasks/TASK-003.md` (Sections 2, 8, 9)
- `README.md`
- `compose.yaml` (to be created)

## Overview

- Pinned PostgreSQL 18.6-bookworm image with manifest-list digest `sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc`.
- Compose file for service `postgres`, bound to `127.0.0.1:5432`, named volume `acos_postgres_data`.
- Root package.json scripts: `infra:up`, `infra:down`, `infra:logs`, `infra:reset`, `verify:infrastructure-pins`, `env:local`.
- `scripts/setup-local-env.mjs` for cross-platform atomic `.env` creation from `.env.example`.
- `scripts/verify-infrastructure-pins.mjs` for inspecting compose.yaml and ci.yml image references and validating manifest list remotely via `docker buildx imagetools inspect`.

## Implementation Steps

1. Create `compose.yaml` with service `postgres`, image `postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc`, loopback port binding `127.0.0.1:5432:5432`, healthcheck (`pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB`), persistent volume.
2. Update `.env.example` with documented local variables.
3. Write `scripts/setup-local-env.mjs`.
4. Write `scripts/verify-infrastructure-pins.mjs` and unit test.
5. Add root scripts to `package.json`.

## Todo List

- [ ] Write `compose.yaml`
- [ ] Update `.env.example`
- [ ] Implement `scripts/setup-local-env.mjs`
- [ ] Implement `scripts/verify-infrastructure-pins.mjs` and test
- [ ] Wire root scripts in `package.json`
