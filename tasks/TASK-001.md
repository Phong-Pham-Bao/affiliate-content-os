# TASK-001 - Bootstrap the TypeScript Workspace and Configuration Boundary

Status: Ready for implementation after Sprint 0/Product Owner approval

Sprint: 1 - Foundation

Owner: Antigravity (Implementation Engineer)

## Objective

Create the smallest deterministic development foundation for Affiliate Content OS: a pinned `pnpm`/Node TypeScript workspace with shared quality gates and one tested `packages/config` boundary that validates environment input and produces redacted configuration metadata.

Do not create web, API, worker, database, queue, AI, or social-platform implementations in this task.

## Context

The repository currently contains architecture documentation only. `docs/ARCHITECTURE.md` selects a strict TypeScript `pnpm` modular monolith with web, API, and worker process types. Every later process needs the same fail-fast configuration rules, and CI needs reliable baseline commands before feature scaffolding begins.

This task deliberately proves the workspace/toolchain and configuration package without making product, hosting-vendor, identity-vendor, or provider-API choices.

Read before implementation:

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md` (especially ADR-002 and ADR-017)
- this task in full

## Required implementation

1. Pin the supported Node major/minor policy in `.nvmrc` (or the repository-standard equivalent), `package.json#engines`, and CI. Select the current Active LTS available at implementation time and record the exact choice in `README.md`; do not use an end-of-life release.
2. Pin the `pnpm` version through `packageManager` and commit `pnpm-lock.yaml`.
3. Create `pnpm-workspace.yaml` for `apps/*` and `packages/*`. Do not create application directories yet.
4. Add root scripts with these stable names: `format`, `format:check`, `lint`, `typecheck`, `test`, `build`, and `check`. The `check` script must aggregate `format:check`, `lint`, `typecheck`, `test`, and `build`.
5. Configure strict TypeScript base settings, ESLint, Prettier, and Vitest. Pin dependency versions in the lockfile. Avoid deprecated packages/config formats when a supported stable format exists.
6. Create `packages/config` as a private workspace package with explicit exports. It must:
   - accept an injected plain key/value environment object rather than reading `process.env` at module import time;
   - validate `NODE_ENV` as `development | test | production`;
   - validate `LOG_LEVEL` against a documented finite set and apply a documented safe default;
   - validate optional `APP_BASE_URL` as an absolute `http`/`https` URL, while requiring `https` in production;
   - reject invalid values at startup with a typed `ConfigurationError` that lists safe field names/reasons but never values;
   - select known keys and ignore unrelated OS environment keys;
   - return an immutable typed configuration object;
   - expose a redacted metadata helper safe for startup logs. It may report presence and non-secret normalized settings, but never raw environment values or URL credentials/query/fragment;
   - contain no secret names yet because production vendors are unresolved.
7. Unit-test the configuration package, including security and production-mode cases.
8. Add a CI workflow for pull requests and the default branch that installs with the frozen lockfile and runs `pnpm check` on the pinned Node version.
9. Update `README.md` with prerequisites, Corepack/`pnpm` setup, install, all quality commands, and a concise workspace map. State explicitly that application processes do not exist yet.
10. Keep all source/config text UTF-8 and correct the README only; do not opportunistically rewrite `AGENTS.md` encoding/content unless separately tasked.

## Expected files

Exact config filenames may follow current stable tool requirements, but the expected scope is:

- `.nvmrc` or equivalent Node-version file
- `.gitignore`
- `.editorconfig`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tsconfig.base.json`
- ESLint configuration
- Prettier configuration and ignore file
- Vitest workspace/root configuration if required
- `.github/workflows/ci.yml`
- `packages/config/package.json`
- `packages/config/tsconfig.json`
- `packages/config/src/index.ts`
- focused source modules under `packages/config/src/` only if separation improves clarity
- `packages/config/test/config.test.ts` (or consistent colocated equivalent)
- `README.md`

Do not create placeholder files/directories with no behavior merely to match the future architecture.

## Database changes

None. Do not add an ORM, database driver, migration tool, Docker database, or schema.

## API changes

None. Do not add endpoints, OpenAPI files, HTTP servers, or API packages.

## Frontend changes

None. Do not initialize Next.js, React, CSS, or UI components.

## Backend changes

Add only the framework-independent `packages/config` library. Do not initialize Fastify, a worker, Redis, queues, object storage, authentication, AI, or social adapters.

## Security requirements

- Never commit secrets, realistic tokens, credential-like test fixtures, or populated `.env` files.
- Add `.env`, `.env.*`, coverage, build output, package caches, and editor/OS artifacts to `.gitignore`; allow a future sanitized `.env.example` using an explicit exception if needed.
- Error messages and snapshots must not echo environment values.
- Redaction tests must use sentinel values and assert that none occur in output or serialized errors.
- `APP_BASE_URL` must reject embedded username/password credentials. Redacted metadata must omit path, query, and fragment or reduce the URL to safe origin-only data.
- Configuration objects must be immutable to callers (deep immutability for the current flat shape).
- Do not add install/postinstall scripts that download or execute unreviewed binaries beyond normal pinned package installation.
- CI permissions must be read-only (`contents: read`) and must not request secrets.

## Edge cases

- No environment object or an empty object.
- Missing optional values and default `LOG_LEVEL`.
- Unsupported `NODE_ENV`/`LOG_LEVEL` casing or whitespace; behavior must be deliberate and tested.
- Malformed URL, relative URL, non-HTTP scheme, URL credentials, query, or fragment.
- `http://localhost` in development/test versus any HTTP URL in production.
- An environment object containing many unknown operating-system keys.
- Values that are `undefined`, empty, or whitespace-only.
- Attempted mutation of the returned configuration.
- Multiple calls with different injected environments must be independent; no import-time/global cache.
- Redacted output and errors must not contain sentinel raw values.

## Acceptance criteria

1. A clean checkout with the pinned Node/Corepack setup completes `pnpm install --frozen-lockfile`.
2. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all execute real workspace checks and pass; none is a no-op echo.
3. `pnpm check` runs `format:check`, `lint`, `typecheck`, `test`, and `build`, and exits nonzero if any gate fails. Generated build output remains ignored and is not committed.
4. The configuration package has no import-time read of `process.env` and can parse independent injected objects.
5. Valid development, test, and production configurations return the documented immutable typed shape.
6. Production rejects non-HTTPS `APP_BASE_URL`; all modes reject relative/non-HTTP URLs and embedded credentials.
7. Invalid configuration throws the typed error with field-level safe diagnostics and without exposing supplied values.
8. Redacted metadata reveals no sentinel URL path/query/fragment/credentials or arbitrary environment values.
9. Unknown OS environment keys do not break parsing and do not appear in returned/redacted configuration.
10. Tests cover every edge case above and include both positive and negative assertions.
11. CI uses the pinned Node and `pnpm`, a frozen lockfile, least permissions, cache keyed by the lockfile, and runs `pnpm check`.
12. README instructions reproduce the verified commands and do not claim any app/database/provider functionality exists.
13. Git diff contains no application scaffolding, generated build output, coverage, secrets, or changes outside this task's scope.

## Test plan

Automated unit tests:

- Parse minimal/default configuration.
- Parse each allowed environment and log level.
- Reject unsupported/empty values according to the documented normalization policy.
- Validate URL schemes, absoluteness, credentials, and production HTTPS.
- Confirm unknown keys are ignored and not returned.
- Confirm returned object cannot be changed.
- Confirm two parses do not share state.
- Confirm typed error structure and absence of sentinel values after stringification.
- Confirm redacted metadata contains only allowlisted safe keys and origin-only URL representation.

Verification commands to run and report verbatim with results:

```text
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
```

Also inspect `git status --short` and the final diff to confirm no secret/env/build artifacts are tracked.

## Out of scope

- Any product feature or UI.
- `apps/web`, `apps/api`, or `apps/worker` scaffolding.
- Authentication or authorization.
- Database schema, migrations, ORM, containers, or seed data.
- Queue/scheduler/outbox.
- AI gateway or model SDK.
- Threads, TikTok, OAuth, or any external API.
- Media/object storage.
- Production infrastructure/vendor selection.
- Deployment workflows, releases, Dockerfiles, or infrastructure as code.
- Dependency-update bots, commit hooks, or monorepo build orchestrators unless a demonstrated need blocks the required commands.
- Editing architecture specifications or expanding scope without Codex approval.

## Implementation handoff requirements

Antigravity must follow `AGENTS.md`, run every verification command, and report created/modified/deleted files, test/build/typecheck/lint results, known issues, and deviations. Do not claim architectural approval; Codex will review the actual diff and executed evidence.
