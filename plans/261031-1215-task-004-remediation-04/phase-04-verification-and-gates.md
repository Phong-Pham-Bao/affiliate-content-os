# Phase 04: Verification and Quality Gates

## Context Links

- Specification: [TASK-004-REMEDIATION-04.md](file:///C:/Users/Win%2010/affiliate-content-os/tasks/TASK-004-REMEDIATION-04.md)

## Required Verification Commands

```text
node --version
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm env:local
docker compose config --quiet
corepack pnpm verify:infrastructure-pins
corepack pnpm infra:up
corepack pnpm db:migrate:validate
corepack pnpm test:integration
corepack pnpm format:check
corepack pnpm lint:boundaries
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
corepack pnpm audit --prod --audit-level high
corepack pnpm verify:trivy-exception
corepack pnpm infra:down
git diff --check
git status --short --branch
```

Also run:

- pinned-image inspection
- both required Trivy scans
- no-ignore negative control
- runtime smoke tests
- git diff check
- clean-checkout verification
- commit and push to `agy/task-004-workspace-tenancy-core`
- exact-SHA GitHub checks confirmation

## Todo List

- [ ] Run full local suite and integration tests
- [ ] Run Trivy scans and exception verification
- [ ] Run git diff checks
- [ ] Push and verify GitHub CI runs
