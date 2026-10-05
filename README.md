# Affiliate Content OS

Deterministic development foundation and configuration boundary for Affiliate Content OS.

> **Status Notice:** This repository currently contains the core TypeScript workspace tooling and the tested `@affiliate-content-os/config` package. Application processes (`apps/web`, `apps/api`, `apps/worker`), databases, queues, AI models, and social platform integrations do not exist yet.

## Prerequisites

- **Node.js**: `24.14.0` (Active LTS pinned in `.nvmrc`, engines range `>=24.14.0 <25.0.0`)
- **pnpm**: `12.4.2` (pinned via `packageManager` and engines in `package.json`)

## Setup

Enable Corepack or use installed `pnpm`:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

## Quality Gates

The workspace enforces strict verification commands:

| Command             | Description                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm format:check` | Check code formatting via Prettier                                                       |
| `pnpm format`       | Auto-format files via Prettier                                                           |
| `pnpm lint`         | Lint codebase with ESLint                                                                |
| `pnpm typecheck`    | Run strict TypeScript type checking across source and tests                              |
| `pnpm test`         | Run unit tests with Vitest                                                               |
| `pnpm build`        | Compile package source to dist (source-only build emit)                                  |
| `pnpm check`        | Run all quality gates in sequence (`format:check`, `lint`, `typecheck`, `test`, `build`) |

## Workspace Structure

```text
affiliate-content-os/
├── .github/
│   ├── workflows/ci.yml       # GitHub Actions CI workflow (Node 24 LTS, frozen lockfile)
│   └── pull_request_template.md
├── docs/                      # Architectural specifications & decision records
├── packages/
│   └── config/                # Environment configuration boundary & redaction helper
│       ├── src/               # Package source code
│       ├── test/              # Unit & security tests
│       ├── package.json       # Package manifest & build/typecheck scripts
│       ├── tsconfig.json      # Strict typecheck config (source + tests)
│       └── tsconfig.build.json# Source-only build configuration (emits to dist)
├── tasks/                     # Task specifications (Codex)
├── .editorconfig
├── .gitignore
├── .nvmrc                     # Pinned Node.js version (24.14.0)
├── eslint.config.mjs          # Flat ESLint configuration
├── package.json               # Root workspace manifest & quality scripts
├── pnpm-lock.yaml             # Pinned dependency lockfile
├── pnpm-workspace.yaml        # Workspace package patterns (apps/*, packages/*)
├── tsconfig.base.json         # Strict TypeScript compiler options
└── vitest.config.ts           # Vitest test runner configuration
```

## Public Configuration Contract (`@affiliate-content-os/config`)

The `@affiliate-content-os/config` package establishes an immutable, fail-fast configuration boundary that validates environment input and exposes safe redaction helpers for startup logging.

### Boundary Principles

1. **Injected Environment**: `loadConfig(rawEnv?: unknown)` accepts an injected key-value record rather than reading `process.env` at module import time. Successive invocations are completely independent with no global caching.
2. **Strict Input Validation**: Missing arguments, `null`, arrays, primitives, and non-record inputs are rejected at runtime with `ConfigurationError` without leaking supplied values.
3. **Unknown Key Filtering**: Known configuration keys are extracted; arbitrary operating-system environment variables (such as `PATH` or cloud secrets) are ignored and excluded from returned configuration objects.
4. **Deep Immutability**: All returned configuration and metadata objects are frozen via `Object.freeze` and immutable to callers.
5. **Non-Disclosure**: Error messages, issue objects, stringified representations, and serialization formats never echo raw environment values, credentials, or sensitive inputs.

### Supported Environment Variables

| Variable       | Required | Type / Allowed Values                                                    | Default  | Rules & Constraints                                                                                                                                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`     | Yes      | `'development'` \| `'test'` \| `'production'`                            | None     | Must be exact lowercase string. Missing, empty, whitespace-padded, or unsupported values are rejected.                                                                                                 |
| `LOG_LEVEL`    | No       | `'trace'` \| `'debug'` \| `'info'` \| `'warn'` \| `'error'` \| `'fatal'` | `'info'` | Optional. When omitted, defaults to `'info'`. Unsupported casing, whitespace, or empty strings are rejected.                                                                                           |
| `APP_BASE_URL` | No       | `string` (valid absolute URL)                                            | None     | Must be absolute `http` or `https` URL without credentials (`user:pass`), query strings (`?q=`), or hash fragments (`#hash`). In `production` mode, `https` protocol is required (`http` is rejected). |

### Exported API

```ts
import {
  loadConfig,
  getRedactedConfigMetadata,
  ConfigurationError,
  type AppConfig,
  type RedactedConfigMetadata,
  type ConfigurationIssue,
  type RawEnvironment,
  type NodeEnv,
  type LogLevel,
  ALLOWED_NODE_ENVS,
  ALLOWED_LOG_LEVELS,
  DEFAULT_LOG_LEVEL,
} from '@affiliate-content-os/config';
```

- `loadConfig(rawEnv?: unknown): AppConfig`: Validates and returns an immutable `AppConfig` object `{ nodeEnv, logLevel, appBaseUrl? }`. Throws `ConfigurationError` on any validation failure.
- `getRedactedConfigMetadata(config: AppConfig): RedactedConfigMetadata`: Generates startup-safe diagnostic metadata `{ nodeEnv, logLevel, hasAppBaseUrl, appBaseUrlOrigin? }`. The `appBaseUrlOrigin` is reduced strictly to scheme, host, and port (e.g. `https://example.com:8443`), stripping any path, query, or fragment.
- `ConfigurationError`: Subclass of `Error` containing a frozen `issues: readonly ConfigurationIssue[]` list and a safe `toJSON()` implementation.

## Development & Branching Workflow

All implementation changes follow the collaborative branch and PR workflow defined in `AGENTS.md`:

1. **Branch Naming**: `agy/<task-id>-<slug>` (e.g. `agy/task-001-foundation`)
2. **Commit Convention**: `feat: implement TASK-<xxx> <description>` or `fix: address TASK-<xxx> <description>`
3. **Pull Request**: Push branch to origin and open a PR targeting `main`. Do not merge until reviewed and approved by Codex (`STATUS: APPROVED`).
