# Phase 06: Architecture Boundaries, CI & Verification

## Context

- `tasks/TASK-004.md` section 4, test plan, required verification
- `docs/ARCHITECTURE.md` section 2, 21

## Requirements

- Synchronize `package.json` dependencies and `pnpm-lock.yaml`.
- Ensure boundary tests in `test/boundaries.test.ts` pass and update if needed for new packages.
- Run complete verification sequence:
  - `node --version`
  - `corepack pnpm --version`
  - `corepack pnpm install --frozen-lockfile`
  - `corepack pnpm env:local`
  - `docker compose config --quiet`
  - `corepack pnpm verify:infrastructure-pins`
  - `corepack pnpm infra:up`
  - `corepack pnpm db:migrate:validate`
  - `corepack pnpm test:integration`
  - `corepack pnpm format:check`
  - `corepack pnpm lint:boundaries`
  - `corepack pnpm lint`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm build`
  - `corepack pnpm check`
  - `corepack pnpm audit --prod --audit-level high`
  - `corepack pnpm verify:trivy-exception`
  - `corepack pnpm infra:down`
  - `git diff --check`
  - `git status --short`
- Commit and push to `agy/task-004-workspace-tenancy-core`.
- Produce final report.
