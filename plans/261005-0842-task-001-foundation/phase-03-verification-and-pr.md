# Phase 3: Verification, Push & Pull Request

## Context Links
- [tasks/TASK-001.md](file:///c:/Users/Win%2010/affiliate-content-os/tasks/TASK-001.md)
- [AGENTS.md](file:///c:/Users/Win%2010/affiliate-content-os/AGENTS.md)

## Overview
Execute all required verification gates, commit using the approved commit message convention, push the task branch `agy/task-001-foundation` to origin, generate the PR template output, and do not merge.

## Verification Commands
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

## Git Commands
```bash
git add .
git commit -m "feat: implement TASK-001 project foundation"
git push -u origin agy/task-001-foundation
```

## Pull Request Policy
- Target: `main`
- Source: `agy/task-001-foundation`
- Status: Awaiting Codex review and PO approval (DO NOT MERGE)
