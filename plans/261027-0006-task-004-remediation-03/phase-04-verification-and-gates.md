# Phase 04: Verification and Gates

## Context

- `tasks/TASK-004-REMEDIATION-03.md` Section "Required verification"
- All gates required by TASK-004, TASK-004-REMEDIATION-01, TASK-004-REMEDIATION-02

## Execution Sequence

1. Format check: `corepack pnpm format:check`
2. Boundary check: `corepack pnpm lint:boundaries`
3. Lint: `corepack pnpm lint`
4. Typecheck: `corepack pnpm typecheck`
5. Unit tests: `corepack pnpm test`
6. Build: `corepack pnpm build`
7. Aggregate check: `corepack pnpm check`
8. Infrastructure up: `corepack pnpm infra:up`
9. Migration validation: `corepack pnpm db:migrate:validate`
10. Integration tests: `corepack pnpm test:integration`
11. Security audit: `corepack pnpm audit --prod --audit-level high`
12. Trivy exception validation: `corepack pnpm verify:trivy-exception`
13. Infrastructure down: `corepack pnpm infra:down`
14. Git diff check: `git diff --check`
15. Clean checkout verification in temporary directory.
16. Commit and push to `origin/agy/task-004-workspace-tenancy-core`.
