# Phase 1: Git Branch and Rules Setup

## Context Links
- [AGENTS.md](file:///c:/Users/Win%2010/affiliate-content-os/AGENTS.md)
- [agent.md](file:///c:/Users/Win%2010/affiliate-content-os/.agents/agents/implementation-engineer/agent.md)
- [.github/pull_request_template.md](file:///c:/Users/Win%2010/affiliate-content-os/.github/pull_request_template.md)

## Overview
Document the mandatory Git branch naming convention, commit rules, and Pull Request workflow. Then create and switch to branch `agy/task-001-foundation`.

## Key Insights
- Branch convention: `agy/task-<xxx>-<slug>` (e.g. `agy/task-001-foundation`, `agy/task-002-products`, `agy/task-003-ai-analysis`, `agy/task-004-content-engine`).
- Commit convention: `feat: implement TASK-<xxx> <description>`.
- Push to origin: `git push -u origin agy/task-<xxx>-<slug>`.
- Open PR to `main`: do NOT merge. Codex reviews and approves before any merge.

## Implementation Steps
1. Update `AGENTS.md` with explicit Git Branching & Pull Request rules under Development Workflow.
2. Update `.agents/agents/implementation-engineer/agent.md` to reflect the branch and PR requirement.
3. Populate `.github/pull_request_template.md` with structured PR template.
4. Create and checkout branch `agy/task-001-foundation`.

## Todo List
- [ ] Update `AGENTS.md`
- [ ] Update `.agents/agents/implementation-engineer/agent.md`
- [ ] Populate `.github/pull_request_template.md`
- [ ] Checkout branch `agy/task-001-foundation`
