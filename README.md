# Affiliate Content OS

Deterministic development foundation and configuration boundary for Affiliate Content OS.

> **Status Notice:** This repository currently contains the core TypeScript workspace tooling and the tested `@affiliate-content-os/config` package. Application processes (`apps/web`, `apps/api`, `apps/worker`), databases, queues, AI models, and social platform integrations do not exist yet.

## Prerequisites

- **Node.js**: `24.14.0` (Active LTS pinned in `.nvmrc`)
- **pnpm**: `12.4.2` (pinned via `packageManager` in `package.json`)

## Setup

Enable Corepack or use installed `pnpm`:

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Quality Gates

The workspace enforces strict verification commands:

| Command             | Description                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm format:check` | Check code formatting via Prettier                                                       |
| `pnpm format`       | Auto-format files via Prettier                                                           |
| `pnpm lint`         | Lint codebase with ESLint                                                                |
| `pnpm typecheck`    | Run TypeScript type checking across all workspace packages                               |
| `pnpm test`         | Run unit tests with Vitest                                                               |
| `pnpm build`        | Compile packages (`packages/config`) to dist                                             |
| `pnpm check`        | Run all quality gates in sequence (`format:check`, `lint`, `typecheck`, `test`, `build`) |

## Workspace Structure

```text
affiliate-content-os/
├── .github/
│   ├── workflows/ci.yml       # GitHub Actions CI workflow
│   └── pull_request_template.md
├── docs/                      # Architectural specifications & decision records
├── packages/
│   └── config/                # Environment configuration boundary & redaction helper
├── plans/                     # Development & implementation plans
├── tasks/                     # Task specifications (Codex)
├── .editorconfig
├── .gitignore
├── .nvmrc                     # Pinned Node.js version (24.14.0)
├── eslint.config.mjs          # Flat ESLint configuration
├── package.json               # Root workspace manifest & quality scripts
├── pnpm-workspace.yaml        # Workspace package patterns (apps/*, packages/*)
├── tsconfig.base.json         # Strict TypeScript compiler options
└── vitest.config.ts           # Vitest test runner configuration
```

## Development & Branching Workflow

All implementation changes follow the collaborative branch and PR workflow defined in `AGENTS.md`:

1. **Branch Naming**: `agy/<task-id>-<slug>` (e.g. `agy/task-001-foundation`)
2. **Commit Convention**: `feat: implement TASK-<xxx> <description>`
3. **Pull Request**: Push branch to origin and open a PR targeting `main`. Do not merge until reviewed and approved by Codex (`STATUS: APPROVED`).
