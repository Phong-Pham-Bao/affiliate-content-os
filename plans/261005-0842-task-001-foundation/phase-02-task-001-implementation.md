# Phase 2: TASK-001 Implementation

## Context Links
- [tasks/TASK-001.md](file:///c:/Users/Win%2010/affiliate-content-os/tasks/TASK-001.md)
- [docs/ARCHITECTURE.md](file:///c:/Users/Win%2010/affiliate-content-os/docs/ARCHITECTURE.md)
- [docs/DECISIONS.md](file:///c:/Users/Win%2010/affiliate-content-os/docs/DECISIONS.md)

## Overview
Bootstrap the TypeScript pnpm monorepo workspace and implement the test-covered `packages/config` package with zero secrets and pure environment injection.

## Implementation Steps
1. Create `.nvmrc` pinning Node 24 (`24.14.0`).
2. Create `.gitignore` and `.editorconfig`.
3. Create root `package.json` with pinned `pnpm@12.4.2`, engines `node: ">=24.0.0"`, and standard scripts:
   - `format`, `format:check`, `lint`, `typecheck`, `test`, `build`, `check`.
4. Create `pnpm-workspace.yaml` declaring `apps/*` and `packages/*`.
5. Configure `tsconfig.base.json`, modern ESLint flat config, Prettier, and Vitest.
6. Create `packages/config`:
   - `package.json`, `tsconfig.json`, `src/index.ts`.
   - `ConfigurationError` typed error with safe field diagnostics, zero values logged/leaked.
   - `loadConfig(env)` function that takes plain record without reading `process.env` at import time.
   - Validates `NODE_ENV`: development | test | production.
   - Validates `LOG_LEVEL`: trace | debug | info | warn | error | fatal (default: info).
   - Validates `APP_BASE_URL`: absolute http/https, https required in production, rejects credentials.
   - `getRedactedConfigMetadata(config)` helper exposing safe origin URL and non-secret fields.
   - Immutability via `Object.freeze`.
7. Write comprehensive Vitest tests in `packages/config/test/config.test.ts`.
8. Create `.github/workflows/ci.yml` running `pnpm check` on PR and push to main.
9. Populate `README.md` with setup, verification instructions, workspace layout, and explicit disclaimer that apps do not exist yet.

## Todo List
- [ ] Root workspace setup (.nvmrc, package.json, pnpm-workspace.yaml, .gitignore, .editorconfig)
- [ ] Linting and formatting setup (tsconfig, eslint, prettier, vitest)
- [ ] `packages/config` implementation
- [ ] `packages/config` tests
- [ ] GitHub Actions CI workflow
- [ ] Update `README.md`
